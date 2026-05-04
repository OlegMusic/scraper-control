/**
 * Custom Google SERP scraper для google.de с geo-targeting.
 *
 * Зачем: получить top-10 для keyword'а в контексте конкретного города (что
 * реально видит пользователь в этом городе) → используем для:
 *   1. Difficulty heuristic (high-authority доли в top-10)
 *   2. Cluster validation (если 2 keywords ранжируют те же URLs — same cluster)
 *   3. Competitor research (кто конкретно в top-3 для нашей ниши)
 *   4. Local Pack detection (есть ли GBP block — индикатор local-intent)
 *
 * Geo через `uule` параметр Google — base64-encoded location string. Формат:
 *   uule = w+CAIQICI<base64-bytes-of-canonical-name>
 * Canonical: "<city>,<region>,<country>" например "Kassel,Hesse,Germany".
 *
 * Через IPRoyal residential rotating proxy — каждый request новый IP, чтобы
 * Google не бил по rate-limit.
 *
 * Rate limit: 60 req/min (через withAutocompleteSlot — общий bucket).
 *
 * ⚠ ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ (2026-05-03): Google.de теперь требует JavaScript
 * для organic search даже с `gbv=1` (no-JS параметр deprecated/throttled).
 * Pure-HTTP scrape возвращает 90KB HTML с "enablejs retry" stub — не parseable.
 * Workaround: переход на puppeteer-based SERP scrape (как radar-scraper) —
 * тогда Google рендерит full HTML в Chrome.
 *
 * Этот файл оставлен как scaffold для будущей puppeteer-based реализации:
 *   - UULE encoding ✓ работает (можно reuse)
 *   - parseSerpHtml() ✓ regex для desktop SERP
 *   - estimateSerpDifficulty() ✓ heuristic
 * Не реализовано: actual fetch — отложено в Slice 3 (puppeteer-fleet).
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { loadProxyConfig, buildProxyUrl } from '../proxy.js';
import { withAutocompleteSlot } from './rateLimiter.js';

const HTTP_TIMEOUT = 18000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// ── UULE encoding для geo-targeting ──────────────────────────────────
// Старый формул "w+CAIQICI<base64>" работает; есть ещё новый формат "a+<base64>"
// который требует знания "Canonical Name ID" из Google Geo API. Используем
// старый — он стабилен много лет.

/**
 * Canonical city → region → country имена для DE.
 * 16 Bundesländer + регион-маппинг.
 */
const CITY_TO_REGION: Record<string, string> = {
  // major hubs
  'berlin': 'Berlin',
  'hamburg': 'Hamburg',
  'münchen': 'Bavaria', 'muenchen': 'Bavaria',
  'köln': 'North Rhine-Westphalia', 'koeln': 'North Rhine-Westphalia',
  'frankfurt': 'Hesse', 'frankfurt am main': 'Hesse',
  'stuttgart': 'Baden-Württemberg',
  'düsseldorf': 'North Rhine-Westphalia', 'duesseldorf': 'North Rhine-Westphalia',
  'leipzig': 'Saxony',
  'hannover': 'Lower Saxony',
  'nürnberg': 'Bavaria', 'nuernberg': 'Bavaria',
  'bremen': 'Bremen',
  'mainz': 'Rhineland-Palatinate',
  'wiesbaden': 'Hesse',
  'saarbrücken': 'Saarland', 'saarbruecken': 'Saarland',
  'kiel': 'Schleswig-Holstein',
  'lübeck': 'Schleswig-Holstein', 'luebeck': 'Schleswig-Holstein',
  'rostock': 'Mecklenburg-Vorpommern',
  'magdeburg': 'Saxony-Anhalt',
  'erfurt': 'Thuringia',
  'görlitz': 'Saxony', 'goerlitz': 'Saxony',
  'cottbus': 'Brandenburg',
  'dresden': 'Saxony',
  'freiburg': 'Baden-Württemberg',
  'karlsruhe': 'Baden-Württemberg',
  'augsburg': 'Bavaria',
  'münster': 'North Rhine-Westphalia', 'muenster': 'North Rhine-Westphalia',
  'bielefeld': 'North Rhine-Westphalia',
  'aachen': 'North Rhine-Westphalia',
  'koblenz': 'Rhineland-Palatinate',
  'trier': 'Rhineland-Palatinate',
  'würzburg': 'Bavaria', 'wuerzburg': 'Bavaria',
  'regensburg': 'Bavaria',
  'kassel': 'Hesse',
  'dortmund': 'North Rhine-Westphalia',
  'essen': 'North Rhine-Westphalia',
  'duisburg': 'North Rhine-Westphalia',
  'bochum': 'North Rhine-Westphalia',
  'mannheim': 'Baden-Württemberg',
};

/**
 * Build canonical name string. Default region если city unknown — "Germany" only.
 */
function buildCanonical(city: string): string {
  const lookup = (city || '').toLowerCase().trim();
  const region = CITY_TO_REGION[lookup];
  if (!region) return `${city},Germany`;
  return `${city},${region},Germany`;
}

/**
 * Encode UULE for old-style format: w+CAIQICI<length-byte><base64-of-canonical>.
 * Length byte = canonical.length (как single hex char or two).
 */
export function buildUule(city: string): string {
  const canonical = buildCanonical(city);
  // Length encoded as raw byte. Старая магия: концатенация length-byte (как char)
  // + canonical-bytes, всё это base64.
  // Working format известный: 'w+CAIQICI' + base64 of (chr(len) + canonical) where chr(len) maps:
  //   0=A, 1=B, ..., 25=Z, 26=a, ..., 51=z, 52=0, ..., 61=9, 62=+, 63=/
  // Plus padding of base64.
  const lenChar = encodeLenAsBase64Char(canonical.length);
  const payload = lenChar + Buffer.from(canonical, 'utf-8').toString('base64');
  return `w+CAIQICI${payload}`;
}

function encodeLenAsBase64Char(n: number): string {
  // Map 0-63 → base64 alphabet
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (n < 0 || n > 63) {
    // Длинные canonical names не поддерживаются простым форматом — fallback на char 'A'
    return 'A';
  }
  return alphabet[n];
}

// ── HTTP fetch ───────────────────────────────────────────────────────
function makeAxios(useProxy: boolean) {
  if (!useProxy) return axios.create({ timeout: HTTP_TIMEOUT });
  const cfg = loadProxyConfig();
  if (!cfg) return axios.create({ timeout: HTTP_TIMEOUT });
  const proxyUrl = buildProxyUrl(cfg, { country: 'de', sticky: false });
  const agent = new HttpsProxyAgent(proxyUrl);
  return axios.create({ timeout: HTTP_TIMEOUT, httpsAgent: agent, httpAgent: agent, proxy: false });
}

// ── Parse SERP HTML ──────────────────────────────────────────────────

export interface SerpResult {
  position: number;
  url: string;
  domain: string;
  title: string;
  snippet?: string;
}

export interface SerpResponse {
  keyword: string;
  city: string;
  results: SerpResult[];
  features: string[];                  // ['featured-snippet', 'people-also-ask', 'local-pack', 'image-pack']
  adCount: number;                     // top + bottom paid slots
  fetchedAt: Date;
  errorMessage?: string;
}

/**
 * Extract canonical https://... URL from Google /url?q=... wrapper.
 */
function unwrapUrl(href: string): string | null {
  if (!href) return null;
  if (href.startsWith('/url?')) {
    const m = href.match(/[?&]q=([^&]+)/);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch { return null; }
    }
  }
  if (href.startsWith('http')) return href;
  return null;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch { return ''; }
}

/**
 * Простой regex-парсер Google SERP HTML без cheerio.
 * Google меняет селекторы часто, но базовая структура `<div class="g">` или
 * `<a href="/url?q=..."><h3>...</h3></a>` стабильна годами для desktop.
 */
function parseSerpHtml(html: string): { results: SerpResult[]; features: string[]; adCount: number } {
  const results: SerpResult[] = [];
  const features: string[] = [];
  let adCount = 0;

  // Detect SERP features by markers in HTML
  if (/People also ask|Ähnliche Fragen/i.test(html)) features.push('people-also-ask');
  if (/Featured snippet|Im Web|Hervorgehobenes Snippet/i.test(html)) features.push('featured-snippet');
  if (/data-async-context.*?map|local-pack|Local Pack/i.test(html)) features.push('local-pack');
  if (/<g-img|gws-thumb/i.test(html)) features.push('image-pack');

  // Count ad slots (top + bottom). Google labels with "Anzeige" or "Sponsored" / "Ad".
  const adMatches = html.match(/(Anzeige|Sponsored|Ad\s*·)/gi) || [];
  adCount = adMatches.length;

  // Extract organic results — match <a href="/url?q=...">...<h3>...</h3>...
  // Строгое regex для desktop SERP HTML.
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>(?:[^<]|<(?!\/a))*?<h3[^>]*>([\s\S]+?)<\/h3>/g;
  let m: RegExpExecArray | null;
  let pos = 0;
  const seenUrls = new Set<string>();
  while ((m = anchorRe.exec(html)) !== null && pos < 10) {
    const href = m[1];
    const url = unwrapUrl(href);
    if (!url || seenUrls.has(url)) continue;
    if (url.includes('google.com/search') || url.includes('google.de/search')) continue;
    seenUrls.add(url);
    const titleHtml = m[2];
    const title = titleHtml.replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    pos++;
    results.push({
      position: pos,
      url,
      domain: getDomain(url),
      title,
    });
  }

  return { results, features, adCount };
}

// ── Public API ───────────────────────────────────────────────────────

export interface ScrapeOpts {
  city: string;
  useProxy?: boolean;                  // default true
  hl?: string;                         // 'de'
  gl?: string;                         // 'de'
}

/**
 * Fetch SERP top-10 для одного keyword'а.
 * Не кидает ошибки наружу — вернёт results: [] + errorMessage.
 */
export async function scrapeOneSerp(keyword: string, opts: ScrapeOpts): Promise<SerpResponse> {
  const useProxy = opts.useProxy !== false;
  const hl = opts.hl || 'de';
  const gl = opts.gl || 'de';
  const uule = buildUule(opts.city);

  // gbv=1 — basic (no-JS) HTML version. Стабильнее для scraping.
  const url = `https://www.google.de/search?q=${encodeURIComponent(keyword)}&hl=${hl}&gl=${gl}&uule=${encodeURIComponent(uule)}&num=10&pws=0&gbv=1`;
  const ax = makeAxios(useProxy);

  try {
    const r = await ax.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': `${hl}-${gl.toUpperCase()},${hl};q=0.9,en;q=0.8`,
        'Accept-Encoding': 'gzip, deflate, br',
        // CONSENT=YES обходит GDPR cookie wall на google.de
        'Cookie': 'CONSENT=YES+DE.de+V14+BX',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      maxRedirects: 5,
      validateStatus: s => s < 500,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    if (r.status === 429 || r.status === 503) {
      return {
        keyword, city: opts.city, results: [], features: [], adCount: 0,
        fetchedAt: new Date(), errorMessage: `rate-limited:${r.status}`,
      };
    }
    if (r.status >= 400) {
      return {
        keyword, city: opts.city, results: [], features: [], adCount: 0,
        fetchedAt: new Date(), errorMessage: `http:${r.status}`,
      };
    }
    const html = String(r.data || '');
    if (html.length < 5000 || /captcha|recaptcha/i.test(html)) {
      return {
        keyword, city: opts.city, results: [], features: [], adCount: 0,
        fetchedAt: new Date(), errorMessage: 'captcha-or-empty',
      };
    }
    const parsed = parseSerpHtml(html);
    return {
      keyword,
      city: opts.city,
      results: parsed.results,
      features: parsed.features,
      adCount: parsed.adCount,
      fetchedAt: new Date(),
    };
  } catch (e: any) {
    return {
      keyword, city: opts.city, results: [], features: [], adCount: 0,
      fetchedAt: new Date(), errorMessage: e.message?.slice(0, 200) || 'unknown',
    };
  }
}

/** Rate-limited вариант. */
export async function scrapeOneSerpRateLimited(keyword: string, opts: ScrapeOpts): Promise<SerpResponse> {
  return withAutocompleteSlot(() => scrapeOneSerp(keyword, opts));
}

/**
 * Batch fetch top-10 для списка keywords. Sequential, throttled, sticky-options.
 */
export async function scrapeBatchSerp(keywords: string[], opts: ScrapeOpts): Promise<SerpResponse[]> {
  const out: SerpResponse[] = [];
  for (const kw of keywords) {
    const r = await scrapeOneSerpRateLimited(kw, opts);
    out.push(r);
  }
  return out;
}

// ── Heuristic difficulty (для дополнительной работы) ─────────────────

const HIGH_AUTHORITY_DOMAINS = new Set([
  'wikipedia.org', 'de.wikipedia.org',
  'handwerkskammer.de', 'zdh.de',
  'gov.de',
  'focus.de', 'spiegel.de', 'welt.de', 'sueddeutsche.de', 'zeit.de', 'stern.de',
  'chip.de', 'computerbild.de',
  'gelbeseiten.de', 'dasoertliche.de', '11880.com', 'cylex.de',
  'youtube.com',
]);

/**
 * Difficulty heuristic 0-100 на основе SERP top-10:
 *   - доля high-authority доменов в top-10 (×40)
 *   - наличие featured-snippet / PAA (×10 each)
 *   - количество ad slots (×5 per slot, capped at 4)
 */
export function estimateSerpDifficulty(serp: SerpResponse): number {
  if (serp.results.length === 0) return 50; // unknown — assume moderate
  const authorityHits = serp.results.filter(r =>
    Array.from(HIGH_AUTHORITY_DOMAINS).some(d => r.domain === d || r.domain.endsWith('.' + d)),
  ).length;
  const authorityPct = authorityHits / serp.results.length;

  let score = authorityPct * 40;
  if (serp.features.includes('featured-snippet')) score += 10;
  if (serp.features.includes('people-also-ask')) score += 10;
  score += Math.min(serp.adCount, 4) * 5;

  return Math.round(Math.min(100, Math.max(5, score)));
}
