import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Persona } from '../db.js';
import { loadProxyConfig, launchBrowserWithProxy } from '../proxy.js';

const r = Router();

r.get('/', async (_req, res) => {
  const list = await Persona.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

r.post('/', async (req, res) => {
  const { name, country = 'de', city, notes, lifetime = '24h', legitimacyConfirmed } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!legitimacyConfirmed) {
    return res.status(400).json({
      error: 'Подтверди что persona легитимна (твой реальный аккаунт, корпоративный multi-location, и т.п.). Фейковые отзывы — нарушение Google ToS и UWG §5.',
    });
  }

  // Зафиксируем session ID и profile dir — для постоянной идентичности
  const proxySessionId = crypto.randomBytes(4).toString('hex');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'persona';
  const profileDir = path.resolve(process.cwd(), 'chrome-profiles', `persona-${slug}-${proxySessionId}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const p = await Persona.create({
    name, country, city, notes,
    proxySessionId,
    proxyLifetime: lifetime,
    profileDir,
    legitimacyConfirmed: true,
  });
  res.json(p);
});

r.put('/:id', async (req, res) => {
  const upd: any = {};
  for (const k of ['name', 'city', 'notes', 'country', 'proxyLifetime']) {
    if (req.body?.[k] !== undefined) upd[k] = req.body[k];
  }
  const p = await Persona.findByIdAndUpdate(req.params.id, { $set: upd }, { new: true });
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

r.delete('/:id', async (req, res) => {
  const p = await Persona.findByIdAndDelete(req.params.id);
  // НЕ удаляем profileDir автоматически — там логины/cookies, юзер может захотеть восстановить
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, hint: `Профиль остался на диске: ${p.profileDir}. Удали вручную если не нужен.` });
});

r.post('/:id/launch', async (req, res) => {
  const cfg = loadProxyConfig();
  if (!cfg) return res.status(400).json({ error: 'IPRoyal не настроен в iproyal-config.json' });
  const p = await Persona.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'persona not found' });

  const result = await launchBrowserForPersona(cfg, p);
  if (result.ok) {
    await Persona.updateOne({ _id: p._id }, { $set: { lastUsedAt: new Date() } });
  }
  res.json(result);
});

async function launchBrowserForPersona(cfg: any, persona: any) {
  const { spawn } = await import('child_process');
  const { buildProxyUrl } = await import('../proxy.js');
  const ProxyChain = await import('proxy-chain');

  const upstreamUrl = buildProxyUrl(cfg, {
    country: persona.country,
    sticky: true,
    lifetime: persona.proxyLifetime,
    sessionId: persona.proxySessionId,
  });

  let localProxyUrl: string;
  try {
    localProxyUrl = await ProxyChain.anonymizeProxy(upstreamUrl);
  } catch (e: any) {
    return { ok: false, error: `proxy-chain failed: ${e.message}` };
  }

  const browserPath = process.env.BROWSER_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

  const args = [
    `--proxy-server=${localProxyUrl}`,
    `--user-data-dir=${persona.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    'https://ipinfo.io',
  ];

  try {
    const proc = spawn(browserPath, args, { detached: true, stdio: 'ignore' });
    proc.unref();
    const upstream = new URL(upstreamUrl);
    return {
      ok: true, pid: proc.pid,
      proxyHost: upstream.hostname, proxyPort: parseInt(upstream.port, 10),
      country: persona.country,
      sessionId: persona.proxySessionId,
      profileDir: persona.profileDir,
    };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export default r;
