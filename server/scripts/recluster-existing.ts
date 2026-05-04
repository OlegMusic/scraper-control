/**
 * Backfill clustering для уже накопленных keywords.
 *
 * Сценарий: у нас есть sc_keywords от прошлых autocomplete прогонов, но clusters
 * не считались (cluster step добавлен в Slice 2). Этот скрипт пересчитывает
 * clusters для уникальных (category, city) пар.
 *
 * Использование:
 *   npx tsx scripts/recluster-existing.ts                          # все пары
 *   npx tsx scripts/recluster-existing.ts --category 'maler und lackierer' --city Kassel
 *   npx tsx scripts/recluster-existing.ts --min-keywords 5 --limit 20
 *
 * Idempotent: replaceOne по {category, city, clusterName}.
 */

import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Keyword, KeywordCluster } from '../src/db.js';
import { clusterKeywords } from '../src/seo-pipeline/keywordClusterer.js';
import { classifyCluster } from '../src/seo-pipeline/pageTypeClassifier.js';
import { filterJunk } from '../src/seo-pipeline/junkFilter.js';
import { reviewAndPersistClustersForPair } from '../src/seo-pipeline/llmOverseer.js';

const argv = process.argv.slice(2);
function getArg(name: string, fallback: string = ''): string {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  return argv[i + 1] || fallback;
}
const argCategory = getArg('--category', '');
const argCity = getArg('--city', '');
const argMinKw = parseInt(getArg('--min-keywords', '3'), 10);
const argLimit = parseInt(getArg('--limit', '0'), 10);
const argCleanJunk = argv.includes('--clean-junk');
const argLlmReview = argv.includes('--llm-review');

async function main() {
  await mongoose.connect(config.mongoUri, { bufferCommands: false });
  console.log(`[recluster] connected: ${config.mongoUri}`);

  // Найти все уникальные (category, city) пары
  const pipeline: any[] = [
    { $match: { category: { $exists: true, $ne: '' }, city: { $exists: true, $ne: '' } } },
  ];
  if (argCategory) pipeline[0].$match.category = argCategory;
  if (argCity) pipeline[0].$match.city = { $regex: '^' + argCity, $options: 'i' };
  pipeline.push(
    { $group: { _id: { category: '$category', city: '$city' }, n: { $sum: 1 } } },
    { $match: { n: { $gte: argMinKw } } },
    { $sort: { n: -1 } },
  );
  if (argLimit > 0) pipeline.push({ $limit: argLimit });

  const pairs = await Keyword.aggregate(pipeline);
  console.log(`[recluster] ${pairs.length} pairs to process`);

  let totalClusters = 0;
  let totalSkipped = 0;
  let totalJunkRemoved = 0;
  let totalLlmReviewed = 0;

  for (let idx = 0; idx < pairs.length; idx++) {
    const p = pairs[idx];
    const category = p._id.category;
    const city = p._id.city;
    let keywords = await Keyword.find({ category, city }).lean();
    if (keywords.length < argMinKw) {
      totalSkipped++;
      continue;
    }
    process.stdout.write(`[${idx + 1}/${pairs.length}] ${category}/${city} (${keywords.length} kw) `);

    // ── --clean-junk: filter существующие keywords + delete rejected ──
    if (argCleanJunk) {
      const filtered = await filterJunk(
        keywords.map(k => k.keyword),
        { providerCategory: category, city, gewerke: [category] },
      );
      const keepSet = new Set(filtered.kept);
      const toDelete = keywords.filter(k => !keepSet.has(k.keyword)).map(k => k._id);
      if (toDelete.length > 0) {
        await Keyword.deleteMany({ _id: { $in: toDelete } });
        // Также убрать из cluster'ов supportingKeywords (т.е. перерасчитать).
        // Достаточно: delete clusters для этой пары — replace ниже создаст новые.
        await KeywordCluster.deleteMany({ category, city });
        totalJunkRemoved += toDelete.length;
      }
      // Перечитать только оставшиеся
      keywords = await Keyword.find({ category, city }).lean();
      process.stdout.write(`(cleaned ${toDelete.length}, kept ${keywords.length}) `);
      if (keywords.length < argMinKw) {
        process.stdout.write(`SKIP (too few after clean)\n`);
        totalSkipped++;
        continue;
      }
    }

    process.stdout.write(`... `);
    try {
      const clusters = await clusterKeywords(
        keywords.map(k => ({
          keyword: k.keyword,
          volume: k.avgMonthlySearches || 0,
          score: k.opportunityScore || 0,
        })),
      );
      for (const cluster of clusters) {
        const pageType = classifyCluster(
          cluster.headKeyword.keyword,
          cluster.supportingKeywords.map(s => s.keyword),
        );
        await KeywordCluster.collection.replaceOne(
          { category, city, clusterName: cluster.clusterName },
          {
            category, city,
            clusterName: cluster.clusterName,
            headKeyword: cluster.headKeyword,
            supportingKeywords: cluster.supportingKeywords,
            volumeTotal: cluster.volumeTotal,
            difficultyAvg: null,
            pageType,
            centroidVector: cluster.centroidVector,
            size: cluster.size,
            generatedAt: new Date(),
          },
          { upsert: true },
        );
      }
      totalClusters += clusters.length;
      process.stdout.write(`${clusters.length} clusters`);

      // --llm-review: LLM overseer на свежих cluster'ах
      if (argLlmReview && clusters.length > 0) {
        try {
          const stats = await reviewAndPersistClustersForPair(category, city, { category, gewerke: [category] });
          totalLlmReviewed += stats.reviewed;
          process.stdout.write(`, llm-reviewed ${stats.reviewed}`);
        } catch (revErr: any) {
          process.stdout.write(`, llm-fail: ${revErr.message?.slice(0, 60)}`);
        }
      }
      console.log('');
    } catch (e: any) {
      console.log(`FAIL: ${e.message?.slice(0, 80)}`);
    }
  }

  console.log(`\n[recluster] DONE — ${totalClusters} clusters across ${pairs.length - totalSkipped} pairs (${totalSkipped} skipped)`);
  if (argCleanJunk) console.log(`[recluster] junk removed: ${totalJunkRemoved} keywords`);
  if (argLlmReview) console.log(`[recluster] llm-reviewed: ${totalLlmReviewed} clusters`);
  await mongoose.disconnect();
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
