import fs from 'fs';
import path from 'path';
import { config } from './config.js';

export interface ScraperInfo {
  file: string;             // "scrape-handwerker-radar.ts"
  category: 'scrape' | 'enrich' | 'extract' | 'import' | 'other';
  description: string;      // первая строка JSDoc, если есть
  argHints: string[];       // строки начинающиеся с "* --foo" в JSDoc — подсказки CLI
  fullPath: string;
}

const HEADER_LINES = 60;

/**
 * Сканирует parser-firecrawl/src/, возвращает все scrape-*.ts / enrich-*.ts / extract-*.ts
 * с попыткой извлечь description + arg-hints из JSDoc.
 */
export function listScrapers(): ScraperInfo[] {
  const srcDir = path.join(config.parserDir, 'src');
  if (!fs.existsSync(srcDir)) return [];

  const files = fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.ts'))
    .filter(f => !f.startsWith('_'))
    .filter(f => /^(scrape|enrich|extract|import|youtube|social|deep|fast|backfill|tag|verify|generate-analytics|handwerker-coverage|handwerker-city-gaps|seed)/.test(f));

  const out: ScraperInfo[] = [];
  for (const f of files) {
    const fullPath = path.join(srcDir, f);
    const head = readHead(fullPath, HEADER_LINES);
    const description = extractDescription(head);
    const argHints = extractArgHints(head);
    const category = categorize(f);
    out.push({ file: f, category, description, argHints, fullPath });
  }

  out.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.file.localeCompare(b.file);
  });
  return out;
}

function readHead(p: string, lines: number): string {
  try {
    const buf = fs.readFileSync(p, 'utf-8');
    return buf.split(/\r?\n/).slice(0, lines).join('\n');
  } catch { return ''; }
}

function extractDescription(head: string): string {
  // Первая значимая строка после "/**" блока
  const lines = head.split(/\r?\n/);
  let inBlock = false;
  for (const ln of lines) {
    const t = ln.trim();
    if (t.startsWith('/**')) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (t.startsWith('*/')) break;
    const cleaned = t.replace(/^\*\s?/, '').trim();
    if (!cleaned) continue;
    if (/^@/.test(cleaned)) continue;
    return cleaned.slice(0, 200);
  }
  return '';
}

function extractArgHints(head: string): string[] {
  const re = /\*\s+(--[a-z][a-z0-9-]*(?:\s+<[^>]+>)?)/gi;
  const hits: string[] = [];
  let m;
  while ((m = re.exec(head)) !== null) {
    if (!hits.includes(m[1])) hits.push(m[1]);
  }
  return hits.slice(0, 8);
}

function categorize(file: string): ScraperInfo['category'] {
  if (file.startsWith('scrape-')) return 'scrape';
  if (file.startsWith('enrich-')) return 'enrich';
  if (file.startsWith('extract-')) return 'extract';
  if (file.startsWith('import-')) return 'import';
  return 'other';
}
