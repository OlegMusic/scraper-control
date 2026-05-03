import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { checkClaude, claudePrompt } from '../claude-bridge.js';

const r = Router();

const SYSTEM = `Ты — Database Assistant для Scraper Control.
Помогаешь пользователю работать с базой ~2M записей Handwerker и других контактов в Германии.

КОНТЕКСТ ПЛАТФОРМЫ:
Пользователь делает SaaS-платформу для немецких Handwerker:
- "Завод сайтов" (genereierung сайтов из FixIt AI)
- "Завод контента" (посты, SMM, соцсети, SEO)
- Цель: помочь Handwerker'ам с цифровым присутствием

ЗАДАЧА:
Помогай находить категории клиентов через DB-запросы:
- "новые каналы TikTok/YouTube" (растущие → ищут услуги)
- "без сайта" (потенциал для Site Factory)
- "слабый сайт" (потенциал для рефакторинга/SEO)
- "без трафика" (нужен SEO/контент)
- "по городам, услугам" (для таргетированных кампаний)

СХЕМА COLLECTION 'providers':
- name, phone, fax, mobile (string)
- email[] (array of strings, поиск 'email.0': {$exists:true})
- website (string или пусто)
- socials.{instagram, facebook, youtube, tiktok, telegram} (string URLs)
- address, city, category, categoryId
- externalSources[] (массив: handwerker-radar, dasoertliche, gelbeseiten, openalex, orcid, etc.)
- youtubePublishedAt (Date) — когда YT канал создан
- youtubeChannelTitle, youtubeCustomUrl
- radarMeta.{radarId, hwkUrl, distanceKm, plz, hwkEnriched}
- rating (Number), ratingCount (Number)
- photos[] (array)
- websiteText (string — scraped HTML, для качества)
- createdAt, updatedAt (Date)

researcher-source ['openalex','orcid','github','gnd'] — НЕ Handwerker, отдельная вертикаль.

ИНСТРУМЕНТЫ:
- count: считает количество по запросу
- find: возвращает sample записей (limit 50)
- aggregate: aggregation pipeline (для группировок, percentile)
- distinct: уникальные значения поля

Отвечай кратко, на русском. Сначала используй tool, потом делай вывод.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'count',
    description: 'Считает количество записей в providers по Mongo-фильтру.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'object', description: 'Mongo find query, например {"city":"Berlin","website":""}' } },
      required: ['query'],
    },
  },
  {
    name: 'find',
    description: 'Возвращает sample записей (max 50) для inspection.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'object' },
        limit: { type: 'number', description: 'max 50' },
        sort: { type: 'object', description: 'например {"updatedAt":-1}' },
        projection: { type: 'object', description: 'Какие поля вернуть' },
      },
      required: ['query'],
    },
  },
  {
    name: 'aggregate',
    description: 'Mongo aggregation pipeline — для группировок, distinct counts, percentile. Maximum 5 stages.',
    input_schema: {
      type: 'object',
      properties: { pipeline: { type: 'array', items: { type: 'object' } } },
      required: ['pipeline'],
    },
  },
  {
    name: 'distinct',
    description: 'Уникальные значения поля (max 100 значений).',
    input_schema: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        query: { type: 'object', description: 'Опциональный фильтр' },
      },
      required: ['field'],
    },
  },
];

function dangerousQuery(q: any): boolean {
  const s = JSON.stringify(q);
  return /\$where|\$function|\$accumulator/.test(s); // запрещаем server-side eval
}

async function executeTool(name: string, input: any): Promise<any> {
  const c = mongoose.connection.collection('providers');
  if (input?.query && dangerousQuery(input.query)) return { error: 'Dangerous operator denied' };
  if (input?.pipeline && dangerousQuery(input.pipeline)) return { error: 'Dangerous operator denied' };

  switch (name) {
    case 'count':
      return { count: await c.countDocuments(input.query || {}) };
    case 'find': {
      const limit = Math.min(parseInt(String(input.limit || 10)), 50);
      const items = await c.find(input.query || {}, { projection: input.projection })
        .sort(input.sort || { updatedAt: -1 }).limit(limit).toArray();
      // Truncate fields для размера
      return items.map((d: any) => {
        if (d.websiteText) d.websiteText = d.websiteText.slice(0, 200) + '…';
        if (d.description) d.description = (d.description || '').slice(0, 200);
        return d;
      });
    }
    case 'aggregate': {
      const pipe = input.pipeline || [];
      if (pipe.length > 5) return { error: 'Pipeline > 5 stages not allowed' };
      const r = await c.aggregate(pipe).toArray();
      return r.slice(0, 100);
    }
    case 'distinct': {
      const r = await c.distinct(input.field, input.query || {});
      return r.slice(0, 100);
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}

interface ChatMsg { role: 'user' | 'assistant'; content: string; }

r.post('/chat', async (req, res) => {
  const { messages = [] } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }

  // Если есть API-ключ — полный режим с tools
  if (config.keys.anthropic) {
    const client = new Anthropic({ apiKey: config.keys.anthropic });
    const apiMessages: any[] = messages.map((m: ChatMsg) => ({ role: m.role, content: m.content }));
    const toolLog: Array<{ tool: string; input: any; output: any }> = [];

    for (let iter = 0; iter < 6; iter++) {
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM,
        tools: TOOLS,
        messages: apiMessages,
      });
      if (resp.stop_reason !== 'tool_use') {
        const text = resp.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
        return res.json({ reply: text, toolLog });
      }
      apiMessages.push({ role: 'assistant', content: resp.content });
      const results: any[] = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const out = await executeTool(block.name, block.input);
          toolLog.push({ tool: block.name, input: block.input, output: out });
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 50000) });
        } catch (e: any) {
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: e.message }), is_error: true });
        }
      }
      apiMessages.push({ role: 'user', content: results });
    }
    return res.json({ reply: '⚠ Max iterations', toolLog });
  }

  // Fallback: Claude CLI без tools — подсказывает SQL/запрос текстом
  const status = await checkClaude();
  if (!status.available) {
    return res.status(503).json({ error: 'Нужен ANTHROPIC_API_KEY или Claude Code CLI.' });
  }
  const lastUser = messages.filter((m: ChatMsg) => m.role === 'user').slice(-1)[0]?.content || '';
  const prompt = `${SYSTEM}\n\n[BRIDGE-MODE: ты не можешь вызывать tools напрямую — дай советы текстом, какие Mongo-запросы пользователь может попробовать в interface]\n\nUser: ${lastUser}\nAssistant:`;
  try {
    const reply = await claudePrompt(prompt, { timeoutMs: 60000 });
    return res.json({ reply, toolLog: [], mode: 'claude-cli' });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default r;
