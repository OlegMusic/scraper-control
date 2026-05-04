/**
 * Autocomplete Scraper — fallback на случай если Google Ads token не дадут.
 *
 * Источники (все бесплатные, без API token):
 *   - Google Autocomplete (suggestqueries.google.com) — главный источник для DE
 *   - YouTube Autocomplete (другой intent — informational/tutorial)
 *   - Bing Autocomplete (даёт уникальные ключи которых нет в Google)
 *   - Amazon DE Autocomplete (commercial intent для product-ниш)
 *
 * Стратегия: рекурсивный обход алфавитом для каждого seed
 *   "küchenmontage" → "küchenmontage a", "küchenmontage b", ..., "küchenmontage z"
 *   "küchenmontage a" → "küchenmontage aa", "küchenmontage ab", ...
 *
 * Дерево вырастает в тысячи long-tail ключей с одного семени.
 *
 * IMPORTANT: rate-limit + опционально через IPRoyal proxy для massive scrape.
 * Без proxy — 2-5 RPS лимит, иначе Google забанит IP на ~1 час.
 */
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { loadProxyConfig, buildProxyUrl } from '../proxy.js';

const ALPHABET_DE = 'abcdefghijklmnopqrstuvwxyzäöüß'.split('');

export type AutocompleteSource = 'google' | 'youtube' | 'bing' | 'amazon-de';

export interface AutocompleteOptions {
  sources?: AutocompleteSource[];      // default: все 4
  hl?: string;                         // language: 'de'
  gl?: string;                         // geo: 'de'
  depth?: number;                      // 1=только seed, 2=seed+letter, 3=seed+letter+letter
  delayMs?: number;                    // между requests
  useProxy?: boolean;                  // через IPRoyal DE
  maxPerSource?: number;               // safeguard
}

interface Suggestion {
  text: string;
  source: AutocompleteSource;
  parentSeed: string;
}

function makeAxios(useProxy: boolean) {
  if (!useProxy) return axios.create({ timeout: 8000 });
  const cfg = loadProxyConfig();
  if (!cfg) return axios.create({ timeout: 8000 });
  const proxyUrl = buildProxyUrl(cfg, { country: 'de', sticky: false });
  const agent = new HttpsProxyAgent(proxyUrl);
  return axios.create({ timeout: 12000, httpsAgent: agent, httpAgent: agent, proxy: false });
}

async function fetchGoogle(query: string, hl: string, gl: string, ax: any): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(query)}`;
  const r = await ax.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, responseType: 'text', transformResponse: [(d: any) => d] });
  // Google returns raw JSON body — parse manually (axios may not auto-parse non-JSON content-type)
  let data: any;
  try { data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; }
  catch { return []; }
  return Array.isArray(data?.[1]) ? data[1].map((s: any) => String(s)) : [];
}

async function fetchYouTube(query: string, hl: string, ax: any): Promise<string[]> {
  const url = `https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&hl=${hl}&ds=yt&q=${encodeURIComponent(query)}`;
  const r = await ax.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  // YouTube returns JSONP с префиксом window.google.ac.h(...)
  const match = String(r.data).match(/\((.+)\)$/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    const sugs = parsed?.[1];
    return Array.isArray(sugs) ? sugs.map((s: any) => String(s[0])) : [];
  } catch { return []; }
}

async function fetchBing(query: string, market: string, ax: any): Promise<string[]> {
  const url = `https://api.bing.com/osjson.aspx?market=${market}&query=${encodeURIComponent(query)}`;
  const r = await ax.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, responseType: 'text', transformResponse: [(d: any) => d] });
  let data: any;
  try { data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; }
  catch { return []; }
  return Array.isArray(data?.[1]) ? data[1].map((s: any) => String(s)) : [];
}

async function fetchAmazonDe(query: string, ax: any): Promise<string[]> {
  const url = `https://completion.amazon.de/api/2017/suggestions?prefix=${encodeURIComponent(query)}&suggestion-type=KEYWORD&mid=A1PA6795UKMFR9&alias=aps`;
  const r = await ax.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const sugs = r.data?.suggestions || [];
  return sugs.map((s: any) => String(s.value));
}

const FETCHERS: Record<AutocompleteSource, (q: string, opts: any, ax: any) => Promise<string[]>> = {
  google: (q, o, ax) => fetchGoogle(q, o.hl || 'de', o.gl || 'de', ax),
  youtube: (q, o, ax) => fetchYouTube(q, o.hl || 'de', ax),
  bing: (q, _o, ax) => fetchBing(q, 'de-DE', ax),
  'amazon-de': (q, _o, ax) => fetchAmazonDe(q, ax),
};

/**
 * Собирает suggestions для одного seed через все источники + рекурсивно расширяет.
 */
export async function expandSeed(seed: string, opts: AutocompleteOptions = {}): Promise<Suggestion[]> {
  const sources = opts.sources || ['google', 'bing'];
  const depth = Math.min(opts.depth || 2, 3);
  const delayMs = opts.delayMs ?? 250;
  const useProxy = opts.useProxy ?? false;
  const maxPerSource = opts.maxPerSource ?? 500;

  const ax = makeAxios(useProxy);
  const seen = new Set<string>();
  const out: Suggestion[] = [];

  async function fetchAll(query: string, level: number) {
    if (level > depth) return;
    if (out.length > sources.length * maxPerSource) return;

    for (const src of sources) {
      try {
        const sugs = await FETCHERS[src](query, opts, ax);
        for (const s of sugs) {
          const k = s.toLowerCase().trim();
          if (!seen.has(k) && k.length > 2 && k.length < 100) {
            seen.add(k);
            out.push({ text: k, source: src, parentSeed: seed });
          }
        }
      } catch (e: any) {
        // 429 или timeout — пропускаем тихо, не валим pipeline
      }
      await new Promise(r => setTimeout(r, delayMs));
    }

    if (level < depth) {
      // Расширение: для каждой буквы алфавита делаем "{query} {letter}"
      for (const letter of ALPHABET_DE) {
        if (out.length > sources.length * maxPerSource) return;
        await fetchAll(`${query} ${letter}`, level + 1);
      }
    }
  }

  await fetchAll(seed, 1);
  return out;
}

/**
 * Batch — для массива seeds. Возвращает плоский массив всех suggestions.
 */
export async function expandSeeds(seeds: string[], opts: AutocompleteOptions = {}): Promise<Suggestion[]> {
  const all: Suggestion[] = [];
  for (const seed of seeds) {
    const r = await expandSeed(seed, opts);
    all.push(...r);
  }
  return all;
}

/**
 * Volume estimation БЕЗ Google Ads API — heuristic через autocomplete-rank.
 * Если ключ появляется в подсказках уже после 2 букв ввода ("ab") → популярный.
 * Если только после 4-5 букв → менее популярный.
 *
 * Грязная эвристика, точность ~60% относительно реального volume,
 * НО бесплатно и доступна сразу.
 */
export async function estimateVolumeByAutocomplete(keyword: string, opts: AutocompleteOptions = {}): Promise<{
  popularityScore: number;       // 0-100
  appearedAtPrefix: string;      // "kü" если появился на 2-х буквах
  source: AutocompleteSource;
}> {
  const sources = opts.sources || ['google'];
  const ax = makeAxios(opts.useProxy ?? false);
  const lower = keyword.toLowerCase().trim();

  for (const src of sources) {
    for (let len = 2; len <= Math.min(lower.length, 8); len++) {
      const prefix = lower.slice(0, len);
      try {
        const sugs = await FETCHERS[src](prefix, opts, ax);
        if (sugs.some(s => s.toLowerCase() === lower)) {
          // Нашли — score = (max-len - found-len) / max-len * 100
          const score = Math.round(((8 - len) / 6) * 100);
          return { popularityScore: Math.max(10, score), appearedAtPrefix: prefix, source: src };
        }
      } catch { /* skip */ }
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return { popularityScore: 5, appearedAtPrefix: '', source: sources[0] };
}
