import mongoose from 'mongoose';
import { KeywordSeed, SeoRun } from '../db.js';

/**
 * Seed Generator — формирует ~10-15K seed keywords для исследования.
 *
 * Источники:
 *  1. providers.category × providers.city — основа
 *  2. Modifiers: + "preise", "kosten", "in der nähe", "24h", "notdienst", "gut", "erfahrung"
 *  3. PLZ long-tail для топ-100 PLZ + категория
 *
 * НЕ ходит в Google. Только генерирует строки для дальнейшего pull в google-ads-api.
 */

const MODIFIERS = ['preise', 'kosten', 'in der nähe', '24h', 'notdienst', 'erfahrung', 'gut', 'günstig', 'empfehlung', 'bewertung'];
const SERVICE_VERBS = ['gesucht', 'finden', 'beauftragen']; // intent-modifiers

interface SeedRecord {
  seed: string;
  category?: string;
  city?: string;
  template: string;
  modifier?: string;
}

export interface GenerateSeedsOptions {
  topCities?: number;     // top-N городов из providers.city
  topPlz?: number;        // top-N PLZ из providers.radarMeta.plz
  includeModifiers?: boolean;
  includeIntent?: boolean;
}

export async function generateSeeds(opts: GenerateSeedsOptions = {}): Promise<{ inserted: number; total: number; runId: string }> {
  const {
    topCities = 60,
    topPlz = 100,
    includeModifiers = true,
    includeIntent = true,
  } = opts;

  const run = await SeoRun.create({ source: 'seed-gen', scope: `cities=${topCities},plz=${topPlz}` });
  const providersCol = mongoose.connection.collection('providers');

  // Топ-категории (Handwerker only)
  const categories: string[] = await providersCol.distinct('category', {
    category: { $exists: true, $ne: '' },
    externalSources: { $nin: ['openalex', 'orcid', 'github', 'gnd'] },
  });

  // Топ городов
  const cityAgg = await providersCol.aggregate([
    { $match: { city: { $exists: true, $ne: '' }, externalSources: { $nin: ['openalex', 'orcid', 'github', 'gnd'] } } },
    { $group: { _id: '$city', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: topCities },
  ]).toArray();
  const cities = cityAgg.map(c => c._id as string).filter(Boolean);

  // Топ PLZ
  const plzAgg = await providersCol.aggregate([
    { $match: { 'radarMeta.plz': { $exists: true, $ne: '' } } },
    { $group: { _id: '$radarMeta.plz', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: topPlz },
  ]).toArray();
  const plzCodes = plzAgg.map(p => p._id as string).filter(Boolean);

  const seeds = new Map<string, SeedRecord>();
  const add = (s: SeedRecord) => {
    const k = s.seed.toLowerCase().trim();
    if (k && !seeds.has(k)) seeds.set(k, { ...s, seed: k });
  };

  // Стратегия 1: category × city
  for (const cat of categories) {
    for (const city of cities) {
      add({ seed: `${cat} ${city}`, category: cat, city, template: 'category-city' });
      if (includeModifiers) {
        for (const mod of MODIFIERS) {
          add({ seed: `${cat} ${city} ${mod}`, category: cat, city, template: 'category-city-modifier', modifier: mod });
        }
      }
    }
  }

  // Стратегия 2: category + modifier (без города — национальные)
  if (includeModifiers) {
    for (const cat of categories) {
      for (const mod of MODIFIERS) {
        add({ seed: `${cat} ${mod}`, category: cat, template: 'category-modifier', modifier: mod });
      }
    }
  }

  // Стратегия 3: category + intent verb
  if (includeIntent) {
    for (const cat of categories) {
      for (const v of SERVICE_VERBS) {
        add({ seed: `${cat} ${v}`, category: cat, template: 'category-intent', modifier: v });
      }
    }
  }

  // Стратегия 4: category × top PLZ (long-tail)
  for (const cat of categories.slice(0, 30)) { // только топ-30 категорий по PLZ — ограничиваем объём
    for (const plz of plzCodes.slice(0, 50)) {
      add({ seed: `${cat} ${plz}`, category: cat, template: 'category-plz' });
    }
  }

  // Bulk upsert
  const ops = Array.from(seeds.values()).map(s => ({
    updateOne: {
      filter: { seed: s.seed },
      update: {
        $setOnInsert: { ...s, processed: false, createdAt: new Date() },
        $set: { updatedAt: new Date() },
      },
      upsert: true,
    },
  }));

  let inserted = 0;
  if (ops.length > 0) {
    const res = await KeywordSeed.collection.bulkWrite(ops, { ordered: false });
    inserted = res.upsertedCount;
  }

  await SeoRun.updateOne({ _id: run._id }, {
    $set: {
      endedAt: new Date(),
      totalKeywords: seeds.size,
      newKeywords: inserted,
      status: 'completed',
    },
  });

  return { inserted, total: seeds.size, runId: String(run._id) };
}

export async function getSeedStats(): Promise<{ total: number; processed: number; pending: number }> {
  const total = await KeywordSeed.countDocuments({});
  const processed = await KeywordSeed.countDocuments({ processed: true });
  return { total, processed, pending: total - processed };
}
