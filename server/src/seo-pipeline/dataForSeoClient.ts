/**
 * DataForSEO API client — SERP analysis for top-N keywords.
 *
 * Phase 0 skeleton: graceful fallback если креды не заданы.
 *
 * Pricing: ~$0.0006 per SERP request. Запускаем только для keywords с volume > 50.
 * 1000 SERPs ≈ $0.60.
 *
 * Setup в .env:
 *   DATAFORSEO_LOGIN
 *   DATAFORSEO_PASSWORD
 * (https://app.dataforseo.com/api-access)
 */
import axios from 'axios';

const API_BASE = 'https://api.dataforseo.com/v3';

export interface SerpResult {
  keyword: string;
  top10: Array<{
    position: number;
    domain: string;
    url: string;
    title: string;
    description?: string;
  }>;
  features: string[];                  // ['featured_snippet', 'people_also_ask', 'local_pack', ...]
  totalResultsCount?: number;
}

function getAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return Buffer.from(`${login}:${password}`).toString('base64');
}

export function isConfigured(): boolean { return getAuth() !== null; }

export async function getSerp(keyword: string, opts?: { city?: string }): Promise<SerpResult | null> {
  const auth = getAuth();
  if (!auth) return null;

  // location_code: 2276 = Germany, language_code: de
  // location_name можно использовать с городом для geo-targeted SERP
  const taskBody = [{
    keyword,
    language_code: 'de',
    location_code: 2276,
    ...(opts?.city ? { location_name: `${opts.city}, Germany` } : {}),
    depth: 10,
    device: 'desktop',
  }];

  try {
    const resp = await axios.post(
      `${API_BASE}/serp/google/organic/live/regular`,
      taskBody,
      {
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    const task = resp.data?.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      console.warn(`DataForSEO error for "${keyword}":`, task?.status_message);
      return null;
    }
    const result = task.result?.[0];
    if (!result) return null;

    const items = (result.items || []) as any[];
    const organic = items
      .filter(i => i.type === 'organic')
      .slice(0, 10)
      .map(i => ({
        position: i.rank_absolute || i.rank_group || 0,
        domain: i.domain || '',
        url: i.url || '',
        title: i.title || '',
        description: i.description,
      }));

    const features = Array.from(new Set(items.map(i => i.type).filter((t: string) =>
      t !== 'organic' && t !== 'related_searches'
    )));

    return {
      keyword,
      top10: organic,
      features,
      totalResultsCount: result.se_results_count,
    };
  } catch (e: any) {
    console.error('DataForSEO request failed:', e.message?.slice(0, 200));
    return null;
  }
}

/**
 * Batch SERP — вызывает getSerp последовательно с throttle (~10 req/sec safe).
 * Возвращает массив результатов в том же порядке что keywords (null если fail).
 */
export async function getBatchSerps(keywords: string[], opts?: { city?: string; delayMs?: number }): Promise<Array<SerpResult | null>> {
  const delay = opts?.delayMs ?? 100;
  const out: Array<SerpResult | null> = [];
  for (const k of keywords) {
    const r = await getSerp(k, opts);
    out.push(r);
    if (delay > 0) await new Promise(res => setTimeout(res, delay));
  }
  return out;
}

/**
 * Считает heuristic SERP difficulty (0-100) на основе top-10 доменов.
 * Простейшая эвристика: если много high-DR доменов (gov/.de official/wikipedia/big media) → высокий difficulty.
 * Без DR API — использует whitelist known authority domains.
 */
const HIGH_AUTHORITY_DOMAINS = [
  /\.gov\.|gesetz/i,
  /handwerkskammer\.de|hwk-/i,
  /wikipedia\.org/i,
  /amazon\.de|ebay\.de|kleinanzeigen\.de/i,
  /chefkoch\.de|gutefrage\.net|fragen\.de/i,
  /immobilienscout24\.de|immowelt\.de/i,
  /bauen\.de|hausjournal\.net|baufoerderer\.de/i,
];

export function estimateDifficulty(top10: SerpResult['top10']): number {
  if (!top10.length) return 0;
  let score = 30; // base
  for (const item of top10.slice(0, 5)) {
    if (HIGH_AUTHORITY_DOMAINS.some(re => re.test(item.domain))) score += 8;
  }
  // Если top-3 коммерческие → потенциально легче пробиться
  const top3 = top10.slice(0, 3);
  const commercial = top3.filter(i => /shop|preis|kaufen|store/i.test(i.title)).length;
  if (commercial >= 2) score -= 5;
  return Math.min(100, Math.max(0, score));
}
