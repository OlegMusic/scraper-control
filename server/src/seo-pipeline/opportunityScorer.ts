import { Keyword } from '../db.js';
import mongoose from 'mongoose';

/**
 * Opportunity Score — численная оценка "стоит копать".
 *
 * Формула:
 *   score = volume × (1 / (difficulty + 10))
 *         × cityRelevance
 *         × gscBoost
 *         × competitionPenalty
 *
 * cityRelevance: 1.5 если запрос привязан к городу (geo-modifier), 0.5 если national-only
 * gscBoost: если уже ранжируемся (gscOurPosition known) — рассчитывается на основе позиции
 *   - position 1-3: 0.5 (уже ранжируемся, доп. инвестиция мало даёт)
 *   - position 4-10: 1.5 (можно дотянуться до top-3)
 *   - position 11-30: 2.5 (золотая возможность, "near miss")
 *   - position 31+: 1.0 (есть данные, но далеко)
 *   - не ранжируемся: 1.0 (neutral)
 * competitionPenalty: 1 - (competitionIndex / 200)  — мягкий штраф
 */

interface ScoreFactors {
  volume: number;
  difficulty: number;
  competition: number;
  isGeoTargeted: boolean;
  gscPosition?: number;
}

export function computeScore(f: ScoreFactors): number {
  const baseDifficulty = f.difficulty || 30; // если не известно — assume средний
  const volumeScore = f.volume;
  const difficultyMultiplier = 1 / (baseDifficulty + 10);

  const cityRelevance = f.isGeoTargeted ? 1.5 : 0.5;

  let gscBoost = 1.0;
  if (typeof f.gscPosition === 'number' && f.gscPosition > 0) {
    if (f.gscPosition <= 3) gscBoost = 0.5;
    else if (f.gscPosition <= 10) gscBoost = 1.5;
    else if (f.gscPosition <= 30) gscBoost = 2.5;
    else gscBoost = 1.0;
  }

  const competitionPenalty = 1 - (f.competition || 0) / 200;

  const score = volumeScore * difficultyMultiplier * cityRelevance * gscBoost * competitionPenalty;
  return Math.round(score * 100) / 100;
}

/**
 * Re-score все keywords в коллекции на основе текущих данных.
 * Использует bulkWrite для производительности.
 */
export async function rescoreAll(): Promise<{ updated: number }> {
  const cursor = Keyword.find({}).lean().cursor();
  const ops: any[] = [];
  let updated = 0;

  for await (const k of cursor) {
    const isGeoTargeted = !!k.city;
    const score = computeScore({
      volume: k.avgMonthlySearches || 0,
      difficulty: k.serpDifficulty || 0,
      competition: k.competitionIndex || 0,
      isGeoTargeted,
      gscPosition: (k.gscOurPosition ?? undefined) as number | undefined,
    });
    ops.push({
      updateOne: {
        filter: { _id: k._id },
        update: { $set: { opportunityScore: score } },
      },
    });
    if (ops.length >= 500) {
      const r = await Keyword.collection.bulkWrite(ops, { ordered: false });
      updated += r.modifiedCount;
      ops.length = 0;
    }
  }
  if (ops.length > 0) {
    const r = await Keyword.collection.bulkWrite(ops, { ordered: false });
    updated += r.modifiedCount;
  }
  return { updated };
}

/**
 * Возвращает top-N keywords для конкретной (category, city) пары.
 */
export async function topOpportunities(category?: string, city?: string, limit = 50) {
  const q: any = {};
  if (category) q.category = category;
  if (city) q.city = { $regex: new RegExp('^' + city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
  return Keyword.find(q).sort({ opportunityScore: -1 }).limit(limit).lean();
}

/**
 * Top-N keywords для нескольких category-вариантов (используется когда
 * провайдер имеет HWK Gewerke + Google category — ищем по всем терминам).
 * Case-insensitive по category.
 */
export async function topOpportunitiesMulti(terms: string[], city?: string, limit = 50) {
  if (!terms || terms.length === 0) return [];
  const escapedTerms = terms
    .filter(t => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escapedTerms.length === 0) return [];
  const catRegexes = escapedTerms.map(e => new RegExp('^' + e + '$', 'i'));
  const q: any = { category: { $in: catRegexes } };
  if (city) q.city = { $regex: new RegExp('^' + city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
  return Keyword.find(q).sort({ opportunityScore: -1 }).limit(limit).lean();
}

/**
 * Coverage statistics: сколько уникальных (category, city) пар проанализировано.
 */
export async function getCoverage(): Promise<{ totalKeywords: number; uniquePairs: number; pairsBreakdown: Array<{ category: string; cities: number; keywords: number }> }> {
  const totalKeywords = await Keyword.countDocuments({});
  const pairs = await Keyword.aggregate([
    { $group: { _id: { category: '$category', city: '$city' }, n: { $sum: 1 } } },
    { $count: 'pairs' },
  ]);
  const uniquePairs = pairs[0]?.pairs || 0;

  const byCategory = await Keyword.aggregate([
    { $match: { category: { $exists: true, $ne: '' } } },
    { $group: { _id: '$category', cities: { $addToSet: '$city' }, keywords: { $sum: 1 } } },
    { $project: { category: '$_id', cities: { $size: '$cities' }, keywords: 1, _id: 0 } },
    { $sort: { keywords: -1 } },
    { $limit: 30 },
  ]);

  return { totalKeywords, uniquePairs, pairsBreakdown: byCategory };
}

/**
 * Generate Content Brief для конкретного провайдера.
 * BBITE будет потреблять этот JSON при генерации /experte/{slug}
 */
export async function generateContentBrief(providerId: string) {
  const providersCol = mongoose.connection.collection('providers');
  let _id: any = providerId;
  try {
    if (mongoose.Types.ObjectId.isValid(providerId)) _id = new mongoose.Types.ObjectId(providerId);
  } catch {}

  const provider = await providersCol.findOne({ $or: [{ _id }, { googlePlaceId: providerId }] });
  if (!provider) return null;

  // Расширенный поиск keywords: по handwerkServices.items[] (lowercase Gewerke,
  // как их пишет ensureAutocompleteCoverage в worker'е) ПЛЮС по provider.category.
  // Case-insensitive т.к. category в keywords lowercase, в провайдере — Title Case.
  const searchTerms = new Set<string>();
  if (provider.category) searchTerms.add(String(provider.category).toLowerCase());
  const gewerke: string[] = Array.isArray(provider.handwerkServices?.items) ? provider.handwerkServices.items : [];
  for (const g of gewerke) {
    if (typeof g === 'string') searchTerms.add(g.toLowerCase());
  }
  const opportunities = await topOpportunitiesMulti(Array.from(searchTerms), provider.city as string, 20);
  const mainKw = opportunities[0];

  return {
    providerId: String(provider._id),
    name: provider.name,
    category: provider.category,
    city: provider.city,
    plz: (provider as any).radarMeta?.plz,
    hwkUrl: (provider as any).radarMeta?.hwkUrl,
    mainKeyword: mainKw ? {
      keyword: mainKw.keyword,
      volume: mainKw.avgMonthlySearches,
      difficulty: mainKw.serpDifficulty,
      score: mainKw.opportunityScore,
    } : null,
    supportingKeywords: opportunities.slice(1, 11).map(k => ({
      keyword: k.keyword,
      volume: k.avgMonthlySearches,
      score: k.opportunityScore,
    })),
    serpCompetitors: mainKw?.serpTop10?.slice(0, 5) || [],
    serpFeatures: mainKw?.serpFeatures || [],
    localSignals: {
      city: provider.city,
      plz: (provider as any).radarMeta?.plz,
      hwkChamber: (provider as any).radarMeta?.hwkUrl,
      registeredHandwerker: !!(provider as any).radarMeta?.radarId,
    },
    auditVerdict: (provider as any).audit?.overallNeed,
    recommendations: (provider as any).audit?.recommendations || [],
    generatedAt: new Date().toISOString(),
  };
}
