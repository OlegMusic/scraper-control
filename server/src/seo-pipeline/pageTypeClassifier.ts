/**
 * Heuristic классификатор cluster → page type.
 *
 * Простая мажоритарная логика: если ≥40% keywords cluster'а матчат шаблоны
 * определённого типа — этот тип. Default = 'service-page' (commercial intent).
 *
 * Iteration 3 → LLM-classifier для borderline (Haiku batch).
 */

export type PageType = 'service-page' | 'pricing' | 'faq' | 'job-page' | 'general';

interface PatternSet {
  type: PageType;
  matches: RegExp[];
}

const PATTERN_SETS: PatternSet[] = [
  {
    type: 'pricing',
    matches: [
      /\bpreis(e|liste|en|es)?\b/i,
      /\bkost(en|et)\b/i,
      /\bpreis\s*pro\b/i,
      /\bquadratmeterpreis\b/i,
      /\bstundensatz\b/i,
      /\btarif\b/i,
      /\bkostenvoranschlag\b/i,
    ],
  },
  {
    type: 'faq',
    matches: [
      /^was\s+(kostet|ist|bedeutet|braucht)/i,
      /^wie\s+(viel|lange|oft|funktioniert)/i,
      /^wo\s+(kann|gibt|finde)/i,
      /^wer\s+(macht|kennt|kann)/i,
      /^wann\s+/i,
      /^warum\s+/i,
      /\?$/,
    ],
  },
  {
    type: 'job-page',
    matches: [
      /\bjobs?\b/i,
      /\bausbildung\b/i,
      /\bstellen?\b/i,
      /\bgehalt\b/i,
      /\bverdienst\b/i,
      /\bkarriere\b/i,
      /\barbeitsplatz\b/i,
    ],
  },
];

export function classifyPageType(keywords: string[]): PageType {
  if (keywords.length === 0) return 'general';
  for (const { type, matches } of PATTERN_SETS) {
    const hits = keywords.filter(k => matches.some(re => re.test(k))).length;
    if (hits / keywords.length >= 0.4) return type;
  }
  // Default — основной commercial intent (предполагаем service offering)
  return 'service-page';
}

/** Classify cluster по всем его keywords (head + supporting). */
export function classifyCluster(headKeyword: string, supportingKeywords: string[]): PageType {
  return classifyPageType([headKeyword, ...supportingKeywords]);
}
