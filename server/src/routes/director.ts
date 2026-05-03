import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { Job, Run } from '../db.js';
import { listScrapers } from '../scraper-registry.js';
import { startScraper, stopRun, listActive } from '../process-manager.js';
import { scheduleJob, unscheduleJob } from '../scheduler.js';
import cron from 'node-cron';
import { AGENTS, getAgent } from '../agents.js';
import { checkClaude, claudePrompt } from '../claude-bridge.js';

const r = Router();

const SYSTEM_PROMPT = `Ты — AI Director для платформы Scraper Control.

Управляешь скраперами parser-firecrawl (сбор данных Handwerker, контактов, соцсетей в Германии).
Пользователь пишет на русском/немецком/английском. Отвечаешь на русском по умолчанию.

ТВОИ ВОЗМОЖНОСТИ (через tools):
- list_scrapers, list_jobs, list_active, get_stats — узнать состояние
- run_scraper, schedule_job, update_job, delete_job, stop_run — выполнить действие
- list_agents — посмотреть какие специалисты доступны для консультации
- consult_agent — задать вопрос агенту-специалисту (radar-strategist, enrichment-strategist,
  youtube-specialist, data-analyst, cron-architect, devops). Используй когда нужен экспертный совет.

КОГДА ИСПОЛЬЗОВАТЬ АГЕНТОВ:
- Сложная задача с множеством решений → проконсультируйся со специалистом
- Например: "запускай каждое утро всё на месяц" → сначала consult_agent('cron-architect')
  чтобы получить разумный план без перегрузки IP/квот, потом schedule_job несколько раз
- "Какие города собрать дальше" → consult_agent('data-analyst') + ('radar-strategist')

ПРАВИЛА:
- НИКОГДА не запускай разрушительные действия без подтверждения от пользователя.
- Если задача требует множества действий — сначала перечисли план, спроси согласие, потом выполняй.
- При создании расписаний предпочитай европейское время (Europe/Berlin TZ применится автоматически).
- Если пользователь говорит "каждое утро" — это 6:00 по умолчанию, спроси если важно точное время.
- ВСЕГДА используй tools для действий, не выдумывай результат.
- Не дублируй уже существующие jobs — сначала list_jobs, потом решай создавать или обновлять.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_scrapers',
    description: 'Список всех доступных скриптов parser-firecrawl. Возвращает file (имя), category (scrape/enrich/extract/import/other), description (из JSDoc), argHints (примеры CLI флагов).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_jobs',
    description: 'Список всех cron-расписаний с их статусом enabled/disabled.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_active',
    description: 'Что сейчас выполняется — активные процессы с PID, scraperFile, args.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_stats',
    description: 'Статистика БД parser-firecrawl: total providers, coverage по email/website/socials, gaps.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'run_scraper',
    description: 'Запустить скрипт прямо сейчас (без cron). Args передаются как массив строк, как в CLI.',
    input_schema: {
      type: 'object',
      properties: {
        scraperFile: { type: 'string', description: 'Имя файла, например "scrape-handwerker-radar.ts"' },
        args: { type: 'array', items: { type: 'string' }, description: 'CLI args, например ["--city","Berlin","--plz","10115"]' },
      },
      required: ['scraperFile'],
    },
  },
  {
    name: 'schedule_job',
    description: 'Создать cron-расписание для регулярного запуска скрипта.',
    input_schema: {
      type: 'object',
      properties: {
        scraperFile: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        cron: { type: 'string', description: 'cron expression в формате "min hour dom mon dow" (Europe/Berlin TZ), например "0 6 * * *" для каждый день в 06:00' },
        label: { type: 'string', description: 'Дружественное имя расписания' },
        enabled: { type: 'boolean', description: 'По умолчанию true' },
      },
      required: ['scraperFile', 'cron'],
    },
  },
  {
    name: 'update_job',
    description: 'Изменить существующее расписание — включить/выключить, поменять cron или args.',
    input_schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        enabled: { type: 'boolean' },
        cron: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        label: { type: 'string' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'delete_job',
    description: 'Удалить расписание навсегда.',
    input_schema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
  {
    name: 'stop_run',
    description: 'Остановить активный процесс.',
    input_schema: {
      type: 'object',
      properties: { runId: { type: 'string' } },
      required: ['runId'],
    },
  },
  {
    name: 'list_agents',
    description: 'Список агентов-специалистов которых можно проконсультировать. Каждый имеет id, name, expertise.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consult_agent',
    description: 'Задать вопрос агенту-специалисту. Используй когда нужен экспертный совет перед выполнением сложной задачи. Агент даст текстовый совет, действия выполнишь ты.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'id агента (radar-strategist | enrichment-strategist | youtube-specialist | data-analyst | cron-architect | devops)' },
        question: { type: 'string', description: 'Конкретный вопрос/задача для специалиста' },
        context: { type: 'string', description: 'Доп. контекст (например, output get_stats или list_jobs)' },
      },
      required: ['agentId', 'question'],
    },
  },
];

async function executeTool(name: string, input: any): Promise<any> {
  switch (name) {
    case 'list_scrapers':
      return listScrapers().map(s => ({ file: s.file, category: s.category, description: s.description, argHints: s.argHints }));
    case 'list_jobs':
      return await Job.find().lean();
    case 'list_active':
      return listActive();
    case 'get_stats': {
      const mongoose = (await import('mongoose')).default;
      const c = mongoose.connection.collection('providers');
      const [total, withPhone, withEmail, withWebsite, withSocials, withRadarMeta] = await Promise.all([
        c.countDocuments({}),
        c.countDocuments({ phone: { $exists: true, $ne: '' } }),
        c.countDocuments({ 'email.0': { $exists: true } }),
        c.countDocuments({ website: { $exists: true, $ne: '' } }),
        c.countDocuments({ $or: [
          { 'socials.instagram': { $exists: true, $ne: '' } },
          { 'socials.facebook':  { $exists: true, $ne: '' } },
          { 'socials.youtube':   { $exists: true, $ne: '' } },
        ]}),
        c.countDocuments({ radarMeta: { $exists: true } }),
      ]);
      return { total, withPhone, withEmail, withWebsite, withSocials, withRadarMeta };
    }
    case 'run_scraper': {
      const out = await startScraper({ scraperFile: input.scraperFile, args: input.args || [] });
      return { ok: true, runId: out.runId, pid: out.pid };
    }
    case 'schedule_job': {
      if (input.cron && !cron.validate(input.cron)) return { error: `invalid cron: ${input.cron}` };
      const job = await Job.create({
        scraperFile: input.scraperFile,
        args: input.args || [],
        cron: input.cron,
        label: input.label,
        enabled: input.enabled !== false,
      });
      scheduleJob(job);
      return { ok: true, jobId: String(job._id) };
    }
    case 'update_job': {
      const upd: any = { updatedAt: new Date() };
      if (input.enabled !== undefined) upd.enabled = input.enabled;
      if (input.cron !== undefined) {
        if (!cron.validate(input.cron)) return { error: `invalid cron: ${input.cron}` };
        upd.cron = input.cron;
      }
      if (input.args !== undefined) upd.args = input.args;
      if (input.label !== undefined) upd.label = input.label;
      const job = await Job.findByIdAndUpdate(input.jobId, { $set: upd }, { new: true });
      if (!job) return { error: 'job not found' };
      scheduleJob(job);
      return { ok: true };
    }
    case 'delete_job': {
      unscheduleJob(input.jobId);
      const r = await Job.findByIdAndDelete(input.jobId);
      return { ok: !!r };
    }
    case 'stop_run': {
      const ok = await stopRun(input.runId);
      return { ok };
    }
    case 'list_agents':
      return AGENTS.map(a => ({ id: a.id, name: a.name, emoji: a.emoji, description: a.description, expertise: a.expertise }));
    case 'consult_agent': {
      const agent = getAgent(input.agentId);
      if (!agent) return { error: `agent not found: ${input.agentId}` };
      if (!config.keys.anthropic) return { error: 'ANTHROPIC_API_KEY missing' };
      const sub = new Anthropic({ apiKey: config.keys.anthropic });
      const subResp = await sub.messages.create({
        model: 'claude-haiku-4-5-20251001', // дешевле + быстрее для специалистов
        max_tokens: 1024,
        system: agent.systemPrompt,
        messages: [{
          role: 'user',
          content: `Вопрос: ${input.question}\n\n${input.context ? 'Контекст:\n' + input.context : ''}`,
        }],
      });
      const advice = subResp.content
        .filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      return { agent: agent.name, advice };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

r.get('/agents', (_req, res) => {
  res.json(AGENTS.map(a => ({
    id: a.id, name: a.name, emoji: a.emoji,
    description: a.description, expertise: a.expertise,
  })));
});

r.get('/auth-status', async (_req, res) => {
  const claudeStatus = await checkClaude();
  res.json({
    apiKey: { configured: !!config.keys.anthropic },
    claudeCli: claudeStatus,
    activeMode: config.keys.anthropic ? 'api-key' : (claudeStatus.available ? 'claude-cli' : 'none'),
  });
});

r.post('/chat', async (req, res) => {
  const { messages = [] } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }
  // Если нет API ключа — пробуем Claude Code CLI (онлайн-авторизация юзера)
  if (!config.keys.anthropic) {
    const status = await checkClaude();
    if (!status.available) {
      return res.status(503).json({
        error: 'Авторизация недоступна. Варианты: (1) добавь ANTHROPIC_API_KEY в parser-firecrawl/.env, или (2) установи Claude Code CLI и авторизуйся (`claude login`). После — перезапусти scraper-control сервер.',
      });
    }
    // Claude Code CLI режим — text-only, без custom tools
    const lastUser = messages.filter((m: ChatMessage) => m.role === 'user').slice(-1)[0]?.content || '';
    const fullCtx =
      `${SYSTEM_PROMPT}\n\n` +
      `[ВАЖНО: ты работаешь в bridge-режиме через Claude Code CLI. Tools недоступны, ` +
      `только текстовые советы. Если пользователь просит выполнить действие — скажи какие кнопки/страницы UI ` +
      `нужно использовать в Scraper Control (http://localhost:5173). Доступные страницы: Скраперы, Расписание, Статистика, Настройки.]\n\n` +
      `История диалога:\n${messages.map((m: ChatMessage) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}\n\n` +
      `ASSISTANT:`;
    try {
      const reply = await claudePrompt(fullCtx, { timeoutMs: 90000 });
      return res.json({ reply, toolLog: [], mode: 'claude-cli' });
    } catch (e: any) {
      return res.status(500).json({ error: `Claude CLI error: ${e.message}` });
    }
  }

  const client = new Anthropic({ apiKey: config.keys.anthropic });

  // Adapt messages to Anthropic format
  const apiMessages: any[] = messages.map((m: ChatMessage) => ({
    role: m.role,
    content: m.content,
  }));

  const toolLog: Array<{ tool: string; input: any; output: any }> = [];

  // Tool-use loop — до 8 итераций
  for (let iter = 0; iter < 8; iter++) {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: apiMessages,
    });

    if (resp.stop_reason !== 'tool_use') {
      // Final answer
      const text = resp.content.filter(c => c.type === 'text').map((c: any) => c.text).join('\n');
      return res.json({ reply: text, toolLog });
    }

    // Add assistant tool_use to messages
    apiMessages.push({ role: 'assistant', content: resp.content });

    // Execute all tool_use blocks
    const toolResults: any[] = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      try {
        const out = await executeTool(block.name, block.input);
        toolLog.push({ tool: block.name, input: block.input, output: out });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(out).slice(0, 50000),
        });
      } catch (e: any) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: e.message }),
          is_error: true,
        });
      }
    }
    apiMessages.push({ role: 'user', content: toolResults });
  }

  res.json({ reply: '⚠ Достигнут лимит 8 итераций tool-use. Уточни задачу.', toolLog });
});

export default r;
