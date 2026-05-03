import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Двойная загрузка .env:
//   1. parser-firecrawl/.env — все API-ключи (Google Places, YouTube, Gemini, Firecrawl, TikTok)
//      — единый источник правды для всех скраперов parser-firecrawl
//   2. scraper-control/.env — наш override (PORT, LOG_DIR, ANTHROPIC_API_KEY если есть)
//
// Последовательность важна: PARSER первая, SC вторая → SC может перекрыть значения PARSER'а.
const PARSER_DIR = process.env.PARSER_FIRECRAWL_DIR
  || 'C:/Users/prusi/Desktop/3. Проекты/proekte/parser-firecrawl';
const parserEnvPath = path.join(PARSER_DIR, '.env');
if (fs.existsSync(parserEnvPath)) {
  dotenv.config({ path: parserEnvPath });
}
dotenv.config({ override: true }); // scraper-control/.env (если есть) перекрывает

export const config = {
  port: parseInt(process.env.SC_PORT || '3100', 10),
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27018/parser-firecrawl',
  parserDir: PARSER_DIR,
  logDir: path.resolve(process.env.LOG_DIR || './logs'),
  // API ключи — все опциональные, скраперам передаются через child-process env
  keys: {
    googlePlaces: process.env.GOOGLE_PLACES_API_KEY || '',
    youtube: process.env.YOUTUBE_API_KEY || '',
    gemini: process.env.GEMINI_API_KEY || '',
    firecrawl: process.env.FIRECRAWL_API_KEY || '',
    tiktokClientKey: process.env.TIKTOK_CLIENT_KEY || '',
    tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    anthropic: process.env.ANTHROPIC_API_KEY || '',
  },
  parserEnvPath,
};
