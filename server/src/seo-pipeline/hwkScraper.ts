/**
 * HWK Gewerke Scraper — извлекает «Eingetragene Berufe» (= зарегистрированные виды
 * деятельности / Gewerke) с страницы провайдера в Handwerkskammer.
 *
 * Это — **юридически официальные** услуги провайдера, главный SEO-сигнал и
 * первичный источник keyword'ов когда у провайдера нет сайта.
 *
 * Источник:
 *   - radarMeta.hwkUrl (например http://hwk-kassel.odav.de/43,0,bdbdetail.html?id=28623)
 *   - Большинство HWK Германии используют CMS ODAV — единая структура страницы:
 *       <h5>Eingetragene Berufe</h5>
 *       <p>Uhrmacher<br>Goldschmied</p>
 *   - Fallback patterns: «Tätigkeit», «Handwerksrolle», «Gewerk»
 *
 * Кэширование: результат сохраняется в provider.handwerkServices = {
 *   items: ['Uhrmacher', 'Goldschmied'],
 *   scannedAt: Date,
 *   source: 'hwk-odav',
 *   sourceUrl: '...',
 * }
 *
 * Не дёргается повторно если cached. Refresh — раз в год / по требованию.
 *
 * Rate limit: 1 req/sec на один HWK domain (нет агрессивных банов, но вежливо).
 */

import axios from 'axios';
import { withAutocompleteSlot } from './rateLimiter.js';

const HTTP_TIMEOUT = 12000;
const UA = 'Mozilla/5.0 (compatible; ScraperControl-SEO/1.0; +local)';

export interface HwkServices {
  items: string[];
  scannedAt: Date;
  source: 'hwk-odav' | 'hwk-other' | 'hwk-failed';
  sourceUrl: string;
  rawTitle?: string;       // h1 — обычно имя Betrieb'а (ценный seed)
  rawAddress?: string;     // адрес из HWK (для верификации)
}

/** Strip HTML tags + decode common entities. */
function strip(html: string): string {
  return html.replace(/<br\s*\/?>/gi, ' | ')
             .replace(/<[^>]+>/g, ' ')
             .replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
             .replace(/&szlig;/g, 'ß').replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
             .replace(/&[a-z]+;/gi, ' ')
             .replace(/\s+/g, ' ')
             .trim();
}

/**
 * Парсит страницу. Возвращает services + метаданные.
 * Кидает Error если страница недоступна — caller решает (cache nothing / mark failed).
 */
export async function fetchHwkServices(hwkUrl: string): Promise<HwkServices> {
  let html: string;
  try {
    const r = await axios.get(hwkUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      timeout: HTTP_TIMEOUT,
      maxRedirects: 5,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    html = String(r.data || '');
  } catch (e: any) {
    return {
      items: [],
      scannedAt: new Date(),
      source: 'hwk-failed',
      sourceUrl: hwkUrl,
    };
  }

  // ── Извлечь Eingetragene Berufe / Tätigkeiten / Gewerke ──
  const gewerkePatterns = [
    /<h\d[^>]*>\s*Eingetragene\s+Berufe\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
    /<h\d[^>]*>\s*Berufe\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
    /<h\d[^>]*>\s*T[äa]tigkeit(?:en)?\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
    /<h\d[^>]*>\s*Gewerk(?:e)?\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
    /<h\d[^>]*>\s*Handwerk(?:srolle)?\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
  ];

  let services: string[] = [];
  let matched = false;
  for (const pat of gewerkePatterns) {
    const m = html.match(pat);
    if (m && m[1]) {
      const inner = strip(m[1]);
      services = inner
        .split(/\s*\|\s*|,\s*|;\s*|\n+/)
        .map(s => s.trim())
        .filter(s => s.length >= 3 && s.length < 100);
      matched = true;
      break;
    }
  }

  // ── Извлечь название Betrieb (h1) — ценный seed ──
  let rawTitle: string | undefined;
  const h1m = html.match(/<h1[^>]*>([\s\S]+?)<\/h1>/i);
  if (h1m && h1m[1]) {
    const t = strip(h1m[1]);
    if (t.length > 1 && t.length < 200) rawTitle = t;
  }

  // ── Адрес — h5 Betrieb + следующий p ──
  let rawAddress: string | undefined;
  const addrM = html.match(/<h\d[^>]*>\s*Betrieb\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i);
  if (addrM && addrM[1]) {
    const t = strip(addrM[1]);
    if (t.length > 5 && t.length < 400) rawAddress = t;
  }

  return {
    items: services,
    scannedAt: new Date(),
    source: matched ? 'hwk-odav' : 'hwk-other',
    sourceUrl: hwkUrl,
    rawTitle,
    rawAddress,
  };
}

/** Rate-limited variant — использует общий token bucket (60/min). */
export async function fetchHwkServicesRateLimited(hwkUrl: string): Promise<HwkServices> {
  return withAutocompleteSlot(() => fetchHwkServices(hwkUrl));
}
