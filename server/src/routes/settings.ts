import { Router } from 'express';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

const r = Router();

/**
 * Возвращает СТАТУС каждого ключа без показа значения.
 * Безопасно для UI — секреты никогда не уезжают в браузер.
 */
function maskKey(value: string): { configured: boolean; preview: string } {
  if (!value) return { configured: false, preview: '' };
  if (value.length <= 8) return { configured: true, preview: '••••' };
  return { configured: true, preview: `${value.slice(0, 6)}…${value.slice(-4)}` };
}

interface KeyDescriptor {
  envName: string;
  label: string;
  purpose: string;
  required: boolean;
}

const KEYS: KeyDescriptor[] = [
  { envName: 'GOOGLE_PLACES_API_KEY', label: 'Google Places', purpose: 'Google Places API для скрейперов google-places/', required: false },
  { envName: 'YOUTUBE_API_KEY',       label: 'YouTube Data',  purpose: 'YouTube API v3 для youtube-api-scan / youtube-deep-scan', required: false },
  { envName: 'GEMINI_API_KEY',        label: 'Gemini',        purpose: 'Embeddings для qdrant-index v2', required: false },
  { envName: 'FIRECRAWL_API_KEY',     label: 'Firecrawl',     purpose: 'Firecrawl API для scrape-hwk-firecrawl', required: false },
  { envName: 'TIKTOK_CLIENT_KEY',     label: 'TikTok client',  purpose: 'TikTok OAuth client key', required: false },
  { envName: 'TIKTOK_CLIENT_SECRET',  label: 'TikTok secret',  purpose: 'TikTok OAuth client secret', required: false },
  { envName: 'ANTHROPIC_API_KEY',     label: 'Anthropic',      purpose: 'LLM-генератор скраперов (Phase 2 фича)', required: false },
];

r.get('/keys', (_req, res) => {
  const out = KEYS.map(k => {
    const value = process.env[k.envName] || '';
    const { configured, preview } = maskKey(value);
    return { ...k, configured, preview };
  });
  res.json({
    keys: out,
    parserEnvPath: config.parserEnvPath,
    parserEnvExists: fs.existsSync(config.parserEnvPath),
    scEnvPath: path.resolve(process.cwd(), '.env'),
    scEnvExists: fs.existsSync(path.resolve(process.cwd(), '.env')),
  });
});

r.get('/quota/youtube', async (_req, res) => {
  // Подсказка пользователю где смотреть real-time квоту
  res.json({
    consoleUrl: 'https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas',
    note: 'YouTube Data API v3: 10 000 units/день бесплатно. Real-time использование смотри в Cloud Console (ссылка выше). Тут показываем только конфигурацию.',
    configured: !!process.env.YOUTUBE_API_KEY,
  });
});

r.get('/quota/google-places', async (_req, res) => {
  res.json({
    consoleUrl: 'https://console.cloud.google.com/apis/api/places-backend.googleapis.com/quotas',
    note: 'Google Places API: $200/мес бесплатный кредит. Real-time использование — Cloud Console.',
    configured: !!process.env.GOOGLE_PLACES_API_KEY,
  });
});

export default r;
