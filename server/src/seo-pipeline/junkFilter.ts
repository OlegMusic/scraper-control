/**
 * Junk filter для autocomplete output.
 *
 * Стратегия (Hybrid 1C):
 *   1. Rule blacklist (бренды, generic noise, automotive-mass) ловит ~80% mass-cases.
 *   2. Borderline (прошёл rules, но возможно нерелевантно) → Haiku 4.5 batch (50/call).
 *   3. Если ANTHROPIC_API_KEY нет — borderline пропускаем целиком (graceful degrade).
 *
 * Вход: список keywords + context (provider category, city, gewerke).
 * Выход: kept[] + stats.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

// ── Rules ─────────────────────────────────────────────────────────────

// Major автомобильные бренды — для не-автомобильных категорий это шум,
// а для автомастерских должны лочиться отдельно (контекст).
const CAR_BRANDS = new Set([
  'bmw', 'audi', 'mercedes', 'mercedes-benz', 'volkswagen', 'vw', 'opel', 'ford',
  'porsche', 'tesla', 'toyota', 'honda', 'mazda', 'nissan', 'hyundai', 'kia',
  'skoda', 'seat', 'fiat', 'peugeot', 'citroen', 'renault', 'volvo', 'mini',
  'jaguar', 'land rover', 'subaru', 'mitsubishi', 'lexus', 'infiniti',
  'alfa romeo', 'dacia', 'jeep', 'chrysler',
]);

// Major retail/non-handwerker brands (когда они в keyword'е — это competitor mention,
// не релевантно для нашего провайдера). Word-boundary проверка ниже.
const NON_HANDWERKER_BRANDS = new Set([
  'aldi', 'lidl', 'rewe', 'edeka', 'kaufland', 'penny', 'netto',
  'ikea', 'media markt', 'saturn', 'amazon', 'ebay', 'otto',
  'siemens', 'bayer', 'bosch ag',
]);

// Job-related (отдельный page type, но в commercial cluster шум)
const JOB_PATTERNS = [
  /\bjobs?\b/i, /\bausbildung\b/i, /\bstellen?\b/i, /\bkarriere\b/i,
  /\bgehalt\b/i, /\bverdienst\b/i, /\bberuf\b/i, /\barbeitsplatz\b/i,
];

// Used-goods / commercial-mass automotive шум
const AUTOMOTIVE_MASS = [
  /\bgebrauchtwagen\b/i, /\bgebrauchtwagenh[äa]ndler\b/i,
  /\bauto\s*kaufen\b/i, /\bauto\s*verkaufen\b/i,
  /\bauto[-\s]?händler\b/i, /\bautohaus\b/i, /\bautohäuser\b/i,
  /\bfahrradh[äa]ndler\b/i, /\bbike[-\s]?h[äa]ndler\b/i,
  /\bgeländewagen\b/i, /\bsportwagen\b/i,
];

// Generic SEO noise
const GENERIC_NOISE = [
  /\binnung\b/i,                                  // обычно informational
  /\bkasse\b(?!\w)/i,                             // typo / кассовый аппарат
  /\bbedeutung\b/i,                               // "что значит"
  /\bdefinition\b/i,
];

const VALID_CHARS_RE = /^[\wäöüßÄÖÜ\s\-&.,/+()]+$/;

interface ProviderContext {
  providerCategory: string;
  city: string;
  gewerke?: string[];
  /** Категории-вертикали где car brands могут быть РЕЛЕВАНТНЫ (KFZ-Werkstatt, Autolackiererei). */
  isAutomotiveProvider?: boolean;
}

export interface FilterResult {
  keep: string[];
  reject: Array<{ keyword: string; reason: string }>;
  borderline: string[];
}

/** Эвристика: автомобильный ли провайдер (тогда CAR_BRANDS не filter'им). */
function detectAutomotive(ctx: ProviderContext): boolean {
  if (ctx.isAutomotiveProvider !== undefined) return ctx.isAutomotiveProvider;
  const allTerms = [ctx.providerCategory, ...(ctx.gewerke || [])].join(' ').toLowerCase();
  return /\b(kfz|fahrzeug|auto|karosserie|lackier|reifen|motorrad|mechan)/i.test(allTerms);
}

export function ruleFilter(keywords: string[], ctx: ProviderContext): FilterResult {
  const isAutomotive = detectAutomotive(ctx);
  const keep: string[] = [];
  const reject: Array<{ keyword: string; reason: string }> = [];
  const borderline: string[] = [];
  const seen = new Set<string>();

  for (const raw of keywords) {
    const kw = (raw || '').trim().toLowerCase();
    if (!kw) continue;
    if (seen.has(kw)) continue;
    seen.add(kw);

    // Slot 0: invalid chars / too short / too long
    if (kw.length < 5) { reject.push({ keyword: kw, reason: 'too-short' }); continue; }
    if (kw.length > 80) { reject.push({ keyword: kw, reason: 'too-long' }); continue; }
    if (!VALID_CHARS_RE.test(kw)) { reject.push({ keyword: kw, reason: 'invalid-chars' }); continue; }

    // Slot 1: brand match (word-boundary check)
    let brandHit: string | null = null;
    for (const b of NON_HANDWERKER_BRANDS) {
      const re = new RegExp(`(^|\\W)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
      if (re.test(kw)) { brandHit = b; break; }
    }
    if (!brandHit && !isAutomotive) {
      for (const b of CAR_BRANDS) {
        // word boundary check
        const re = new RegExp(`(^|\\W)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
        if (re.test(kw)) { brandHit = b; break; }
      }
    }
    if (brandHit) {
      reject.push({ keyword: kw, reason: `brand:${brandHit}` });
      continue;
    }

    // Slot 2: job patterns — отдельный page type, но в commercial cluster шум
    if (JOB_PATTERNS.some(re => re.test(kw))) {
      // Не отбрасываем полностью — отправляем в borderline (LLM решит, релевантно ли)
      borderline.push(kw);
      continue;
    }

    // Slot 3: automotive mass (for non-automotive providers)
    if (!isAutomotive && AUTOMOTIVE_MASS.some(re => re.test(kw))) {
      reject.push({ keyword: kw, reason: 'automotive-mass' });
      continue;
    }

    // Slot 4: generic noise
    if (GENERIC_NOISE.some(re => re.test(kw))) {
      reject.push({ keyword: kw, reason: 'generic-noise' });
      continue;
    }

    // Slot 5: keyword не содержит ни categoryTerm ни city — может быть unrelated
    const hasCategoryHint = [ctx.providerCategory, ...(ctx.gewerke || [])]
      .some(t => t && kw.includes(t.toLowerCase().split(' ')[0])); // первое слово category
    const hasCityHint = ctx.city && kw.includes(ctx.city.toLowerCase());
    if (!hasCategoryHint && !hasCityHint) {
      borderline.push(kw);
      continue;
    }

    keep.push(kw);
  }

  return { keep, reject, borderline };
}

/**
 * Sanitize PII перед отправкой в LLM (email, phone).
 */
function sanitize(text: string): string {
  return text
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\+?\d{2,4}[\s\-]?\(?\d{2,5}\)?[\s\-]?\d{2,5}[\s\-]?\d{0,5}/g, (m: string) => m.length >= 7 ? '[phone]' : m);
}

/**
 * LLM batch review — для borderline keywords. Возвращает только те что прошли.
 * При отсутствии ANTHROPIC_API_KEY возвращает все (graceful degrade).
 * При ошибке Anthropic API — возвращает все (не валим pipeline).
 */
export async function llmReviewBatch(
  keywords: string[],
  ctx: ProviderContext,
): Promise<{ kept: string[]; rejected: string[] }> {
  if (keywords.length === 0) return { kept: [], rejected: [] };
  if (!config.keys.anthropic) {
    // No API key — keep all borderline (graceful degrade)
    return { kept: keywords, rejected: [] };
  }
  try {
    const client = new Anthropic({ apiKey: config.keys.anthropic });
    const list = keywords.map((k, i) => `${i + 1}. ${sanitize(k)}`).join('\n');
    const sys = `You are a German SEO keyword classifier. Decide if each keyword is COMMERCIALLY RELEVANT for a Handwerker offering "${ctx.providerCategory}" services in ${ctx.city}, Germany.

Examples of RELEVANT: services they sell, prices, comparisons of their service, location-specific demand.
Examples of IRRELEVANT: jobs/training, competitor brand searches, pure informational queries, unrelated industries, second-hand goods market.

Answer ONLY with one line per keyword: "YES" or "NO". No explanations. Output ${keywords.length} lines, in the same order as input.`;

    const r = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: keywords.length * 8 + 100,
      system: sys,
      messages: [{ role: 'user', content: list }],
    });
    const text = r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    const lines = text.split(/\r?\n/).map(l => l.trim().toUpperCase());

    const kept: string[] = [];
    const rejected: string[] = [];
    for (let i = 0; i < keywords.length; i++) {
      // Парсим line[i] — допускаем "1. YES" / "YES" / "Yes" / варианты
      const line = lines[i] || lines.find(l => l.includes((i + 1) + '.') || l.includes((i + 1) + ')')) || '';
      const isYes = /\bYES\b/.test(line);
      const isNo = /\bNO\b/.test(line);
      if (isYes && !isNo) kept.push(keywords[i]);
      else if (isNo) rejected.push(keywords[i]);
      else kept.push(keywords[i]); // ambiguous → keep (conservative)
    }
    return { kept, rejected };
  } catch (e: any) {
    console.warn('[junkFilter] LLM batch failed:', e.message?.slice(0, 200));
    return { kept: keywords, rejected: [] };
  }
}

/**
 * Полный pipeline: rules + LLM на borderline.
 */
export async function filterJunk(
  keywords: string[],
  ctx: ProviderContext,
): Promise<{
  kept: string[];
  stats: { input: number; ruleKept: number; ruleRejected: number; llmKept: number; llmRejected: number };
}> {
  const ruleResult = ruleFilter(keywords, ctx);
  let llmKept: string[] = [];
  let llmRejected: string[] = [];

  if (ruleResult.borderline.length > 0) {
    // Batch chunks по 50
    const BATCH = 50;
    for (let i = 0; i < ruleResult.borderline.length; i += BATCH) {
      const chunk = ruleResult.borderline.slice(i, i + BATCH);
      const r = await llmReviewBatch(chunk, ctx);
      llmKept.push(...r.kept);
      llmRejected.push(...r.rejected);
    }
  }

  return {
    kept: [...ruleResult.keep, ...llmKept],
    stats: {
      input: keywords.length,
      ruleKept: ruleResult.keep.length,
      ruleRejected: ruleResult.reject.length,
      llmKept: llmKept.length,
      llmRejected: llmRejected.length,
    },
  };
}
