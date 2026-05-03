import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Server as IOServer } from 'socket.io';
import { config } from './config.js';
import { Run } from './db.js';

interface ActiveProcess {
  runId: string;
  proc: ChildProcess;
  scraperFile: string;
  args: string[];
  startedAt: Date;
  logPath: string;
  logStream: fs.WriteStream;
}

const active = new Map<string, ActiveProcess>(); // runId → ActiveProcess

let io: IOServer | null = null;
export function setIo(server: IOServer) { io = server; }

export function listActive(): Array<{
  runId: string; scraperFile: string; args: string[]; pid: number; startedAt: Date;
}> {
  return Array.from(active.values()).map(p => ({
    runId: p.runId,
    scraperFile: p.scraperFile,
    args: p.args,
    pid: p.proc.pid || 0,
    startedAt: p.startedAt,
  }));
}

/**
 * Запускает скрапер в parser-firecrawl директории через `npx ts-node src/<file>`.
 * Создаёт Run запись в Mongo, лог-файл, стримит stdout/stderr через Socket.io.
 */
export async function startScraper(opts: {
  scraperFile: string;
  args: string[];
  jobId?: string;
}): Promise<{ runId: string; pid: number; logPath: string }> {
  const { scraperFile, args, jobId } = opts;

  fs.mkdirSync(config.logDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const logName = `${scraperFile.replace(/\.ts$/, '')}-${ts}.log`;
  const logPath = path.join(config.logDir, logName);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  // Spawn
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const cmdArgs = ['ts-node', `src/${scraperFile}`, ...args];

  const proc = spawn(cmd, cmdArgs, {
    cwd: config.parserDir,
    env: process.env,
    shell: false,
  });

  const run = await Run.create({
    jobId: jobId || undefined,
    scraperFile, args,
    pid: proc.pid,
    startedAt: new Date(),
    logPath,
    status: 'running',
  });
  const runId = String(run._id);

  const ap: ActiveProcess = {
    runId, proc, scraperFile, args,
    startedAt: new Date(), logPath, logStream,
  };
  active.set(runId, ap);

  const broadcast = (kind: 'stdout' | 'stderr', chunk: string) => {
    logStream.write(chunk);
    io?.emit('log', { runId, kind, chunk });
  };

  proc.stdout?.on('data', d => broadcast('stdout', d.toString()));
  proc.stderr?.on('data', d => broadcast('stderr', d.toString()));

  proc.on('exit', async (code, signal) => {
    logStream.end();
    active.delete(runId);
    const reason = signal ? 'killed' : (code === 0 ? 'completed' : 'crashed');
    const status = signal ? 'killed' : (code === 0 ? 'completed' : 'failed');
    await Run.updateOne(
      { _id: run._id },
      { $set: { endedAt: new Date(), exitCode: code ?? -1, exitReason: reason, status } },
    );
    io?.emit('run:end', { runId, exitCode: code, exitReason: reason });
  });

  io?.emit('run:start', { runId, scraperFile, args, pid: proc.pid });
  return { runId, pid: proc.pid || 0, logPath };
}

export async function stopRun(runId: string): Promise<boolean> {
  const ap = active.get(runId);
  if (!ap) return false;
  // Windows: tree kill через taskkill
  if (process.platform === 'win32' && ap.proc.pid) {
    spawn('taskkill', ['/F', '/T', '/PID', String(ap.proc.pid)], { shell: false });
  } else {
    ap.proc.kill('SIGKILL');
  }
  return true;
}

export function tailLog(runId: string, maxBytes = 64 * 1024): string {
  const ap = active.get(runId);
  let p = ap?.logPath;
  if (!p) return '';
  try {
    const stat = fs.statSync(p);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf-8');
  } catch { return ''; }
}
