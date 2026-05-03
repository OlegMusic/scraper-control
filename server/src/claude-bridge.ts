import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Bridge через локально установленный Claude Code CLI.
 *
 * Преимущество: использует существующую авторизацию пользователя в Claude Code
 * (subscription Pro/Max/Team — без ANTHROPIC_API_KEY и оплаты по токенам).
 *
 * Ограничение: subprocess-режим не поддерживает наши custom tools напрямую —
 * Director работает в режиме "text advisor". Для tool use нужен MCP setup.
 */

function findClaudeBinary(): string {
  // 1. Явный путь через env (приоритет)
  if (process.env.CLAUDE_CLI_PATH && fs.existsSync(process.env.CLAUDE_CLI_PATH)) {
    return process.env.CLAUDE_CLI_PATH;
  }
  // 2. Типичные места установки на Windows / Mac / Linux
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    'C:\\Program Files\\Claude\\claude.exe',
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // 3. Fallback — пусть OS ищет в PATH (через shell)
  return 'claude';
}

const CLAUDE_CMD = findClaudeBinary();

export interface ClaudeStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export async function checkClaude(): Promise<ClaudeStatus> {
  return new Promise(resolve => {
    // Если CLAUDE_CMD это абсолютный путь к .exe — shell не нужен (быстрее, надёжнее)
    const useShell = CLAUDE_CMD === 'claude';
    const p = spawn(CLAUDE_CMD, ['--version'], { shell: useShell });
    let out = '';
    let err = '';
    p.stdout?.on('data', d => { out += d.toString(); });
    p.stderr?.on('data', d => { err += d.toString(); });
    p.on('error', e => resolve({ available: false, error: e.message }));
    p.on('exit', code => {
      if (code === 0 && out.match(/\d+\.\d+\.\d+/)) {
        resolve({ available: true, version: out.trim() });
      } else {
        resolve({ available: false, error: err || `exit ${code}` });
      }
    });
  });
}

export async function claudePrompt(
  fullPrompt: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 60000;
  // Workaround Windows-cmd UTF-8 issue: пишем prompt в temp файл (UTF-8 BOM),
  // используем shell-redirect "<" для безопасной передачи в claude -p.
  // Это надёжнее чем stdin pipe / args, оба ломают кириллицу на Windows.
  const tmpFile = path.join(os.tmpdir(), `sc-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmpFile, '﻿' + fullPrompt, { encoding: 'utf-8' });

  return new Promise((resolve, reject) => {
    // На Windows используем cmd с chcp 65001 (UTF-8) перед запуском claude.
    // На *nix — прямой spawn с stdin pipe.
    const isWin = process.platform === 'win32';
    const cmdLine = isWin
      ? `chcp 65001 >NUL && "${CLAUDE_CMD}" -p < "${tmpFile}"`
      : `cat "${tmpFile}" | "${CLAUDE_CMD}" -p`;

    const p = spawn(cmdLine, [], {
      shell: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    p.stdout?.setEncoding('utf-8');
    p.stderr?.setEncoding('utf-8');
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch {}
      reject(new Error(`Claude CLI timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    p.stdout?.on('data', d => { out += d.toString(); });
    p.stderr?.on('data', d => { err += d.toString(); });
    p.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('exit', code => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code === 0) resolve(out);
      else reject(new Error(`Claude CLI exit ${code}: ${err.slice(0, 500)}`));
    });
  });
}
