/**
 * SEO Job Worker — Mongo-backed cron-tick queue для bulk research.
 *
 * Tick каждые 15 сек: атомарно резервирует один pending job → running, обрабатывает
 * batch=25 провайдеров за тик, апдейтит cursorIndex+heartbeat, при паузе/cancel выходит.
 *
 * Idempotency: если для (category, city) уже есть свежие keywords (<30 дней), skip
 * autocomplete — просто generateContentBrief.
 *
 * Restart-safe: zombie reaper в boot hook flip'ит running без heartbeat>5min обратно
 * в pending, worker подхватит через 15s с того же cursorIndex.
 *
 * Socket.io broadcasts: seo:job:progress (per batch), seo:job:end.
 */

import cron from 'node-cron';
import mongoose from 'mongoose';
import { Server as IOServer } from 'socket.io';
import { SeoJob, Keyword } from '../db.js';
import { generateContentBrief, computeScore } from './opportunityScorer.js';
import { expandSeeds, estimateVolumeByAutocomplete } from './autocompleteScraper.js';
import { withAutocompleteSlot } from './rateLimiter.js';
import { filterJunk } from './junkFilter.js';
import { clusterKeywords } from './keywordClusterer.js';
import { classifyCluster } from './pageTypeClassifier.js';
import { reviewAndPersistClustersForPair } from './llmOverseer.js';
import { KeywordCluster } from '../db.js';
import { TARGETS } from '../routes/database.js';

const BATCH_SIZE = 25;
const FRESHNESS_DAYS = 30;
const ZOMBIE_THRESHOLD_MS = 5 * 60 * 1000;
const PROXY_THRESHOLD = 1000;
const MAX_ERRORS_STORED = 100;

let io: IOServer | null = null;
let task: cron.ScheduledTask | null = null;
let busy = false;

export function setIo(server: IOServer) { io = server; }

function emit(event: string, payload: any) {
  if (io) io.emit(event, payload);
}

/**
 * Резолвит selection в массив providerId-ов. На MVP без materialization —
 * каждый раз пере-резолвит (приемлемый mid-run drift для smart-target).
 */
async function resolveSelection(job: any): Promise<mongoose.Types.ObjectId[]> {
  const sel = job.selection;
  const providersCol = mongoose.connection.collection('providers');
  if (sel.kind === 'manual') {
    return (sel.providerIds || []).map((id: any) =>
      typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id,
    );
  }
  if (sel.kind === 'smart-target') {
    const t = TARGETS.find(x => x.id === sel.targetId);
    if (!t) throw new Error(`smart-target '${sel.targetId}' not found`);
    const docs = await providersCol.find(t.query, { projection: { _id: 1 } }).toArray();
    return docs.map(d => d._id as mongoose.Types.ObjectId);
  }
  throw new Error(`unknown selection kind: ${sel.kind}`);
}

/**
 * Дедуплицирует (gewerk|category, city) пары и расширяет autocomplete для тех
 * у кого нет свежих keywords. Только для pipeline='full-research'.
 *
 * Приоритет seed'а:
 *   1. handwerkServices.items[] — юридически зарегистрированные Gewerke (точный
 *      сигнал, особенно критичен для провайдеров без сайта). Каждый Gewerk —
 *      свой seed с городом.
 *   2. Google category — fallback если HWK Gewerke нет (или это не Handwerker).
 */
async function ensureAutocompleteCoverage(
  providerIds: mongoose.Types.ObjectId[],
  useProxy: boolean,
  job: any,
): Promise<void> {
  const providersCol = mongoose.connection.collection('providers');
  const sample = await providersCol.find(
    { _id: { $in: providerIds } },
    { projection: { category: 1, city: 1, 'handwerkServices.items': 1 } },
  ).toArray();

  // Уникальные (seed-term, city) пары. Gewerke имеют приоритет — добавляются
  // первыми; category добавляется только если Gewerke отсутствует у провайдера.
  // Pair key: "term|city" (term = Gewerk OR category)
  // Также храним contextGewerke[] и provider's category для junk-filter (нужен
  // чтобы понять "automotive vs не-automotive provider" при отбраковке brand-mentions).
  type PairMeta = {
    term: string;
    city: string;
    isGewerk: boolean;
    contextGewerke: string[];
    contextCategory: string;
  };
  const pairsByKey = new Map<string, PairMeta>();
  for (const p of sample) {
    if (!p.city) continue;
    const gewerke: string[] = Array.isArray(p.handwerkServices?.items) ? p.handwerkServices.items : [];
    const ctxCategory = String(p.category || '');
    if (gewerke.length > 0) {
      for (const g of gewerke) {
        if (typeof g !== 'string' || g.length < 3) continue;
        const term = g.toLowerCase();
        const key = `${term}|${p.city}`;
        if (!pairsByKey.has(key)) pairsByKey.set(key, {
          term, city: p.city, isGewerk: true,
          contextGewerke: gewerke, contextCategory: ctxCategory,
        });
      }
    } else if (p.category) {
      const term = String(p.category).toLowerCase();
      const key = `${term}|${p.city}`;
      if (!pairsByKey.has(key)) pairsByKey.set(key, {
        term, city: p.city, isGewerk: false,
        contextGewerke: [], contextCategory: ctxCategory,
      });
    }
  }

  const freshCutoff = new Date(Date.now() - FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
  const stalePairs: PairMeta[] = [];

  for (const meta of pairsByKey.values()) {
    // Поле в Keyword: используем meta.term как category-like ключ. Если seeded
    // от Gewerk — пишем оба: category=term + и регистрируем в Keyword (term как category).
    const fresh = await Keyword.countDocuments({ category: meta.term, city: meta.city, fetchedAt: { $gte: freshCutoff } });
    if (fresh < 5) stalePairs.push(meta);
  }

  const gewerkCount = stalePairs.filter(s => s.isGewerk).length;
  console.log(`[seoJob ${job._id}] coverage: ${pairsByKey.size} pairs total, ${stalePairs.length} stale (${gewerkCount} from HWK Gewerke) → autocomplete`);

  for (const meta of stalePairs) {
    const { term, city, isGewerk, contextGewerke, contextCategory } = meta;
    const seeds = [
      `${term} ${city}`,
      `${term} ${city} preise`,
      `${term} ${city} kosten`,
    ];
    try {
      // Stage 1: autocomplete expansion
      const expansions = await withAutocompleteSlot(() =>
        expandSeeds(seeds, { sources: ['google', 'bing'], depth: 1, useProxy, delayMs: 250 }),
      );
      if (expansions.length === 0) continue;

      // Stage 2: junk filter (rules + LLM borderline)
      const filtered = await filterJunk(
        expansions.map(e => e.text),
        { providerCategory: contextCategory || term, city, gewerke: contextGewerke },
      );
      console.log(`[seoJob ${job._id}] ${term}/${city}: ${filtered.stats.input} kw → keep ${filtered.kept.length} (rule rej ${filtered.stats.ruleRejected}, llm rej ${filtered.stats.llmRejected})`);
      if (filtered.kept.length === 0) continue;

      // Stage 3: volume estimation через autocomplete-rank (бесплатно, ±60% accuracy)
      // Rate-limited через withAutocompleteSlot чтобы не словить ban.
      const enriched: Array<{ text: string; volume: number; score: number }> = [];
      for (const text of filtered.kept) {
        let volume = 0;
        try {
          const est = await withAutocompleteSlot(() =>
            estimateVolumeByAutocomplete(text, { sources: ['google'] }),
          );
          // Mapping popularityScore (0-100) → fake avgMonthlySearches range
          // Same маппинг как в /research/estimate-volume endpoint
          volume = Math.round(Math.exp(est.popularityScore / 18) * 10);
        } catch {
          volume = 0;
        }
        const score = computeScore({
          volume,
          difficulty: 0,                     // unknown без DataForSEO
          competition: 0,
          isGeoTargeted: text.toLowerCase().includes(city.toLowerCase()),
        });
        enriched.push({ text, volume, score });
      }

      // Stage 4: bulkWrite в sc_keywords
      const ops: any[] = enriched.map(e => ({
        updateOne: {
          filter: { keyword: e.text },
          update: {
            $set: {
              language: 'de', country: 'DE', category: term, city,
              fetchedAt: new Date(),
              avgMonthlySearches: e.volume,
              opportunityScore: e.score,
            },
            $addToSet: { sources: isGewerk ? 'hwk-gewerk' : 'serp-suggestion' },
            $setOnInsert: { keyword: e.text },
          },
          upsert: true,
        },
      }));
      if (ops.length > 0) await Keyword.collection.bulkWrite(ops, { ordered: false });

      // Stage 5: clustering. Берём все keywords пары (включая freshly inserted)
      // и кластеризуем — group similar keywords.
      try {
        const allForPair = await Keyword.find({ category: term, city }).lean();
        if (allForPair.length >= 3) {
          const clusters = await clusterKeywords(
            allForPair.map(k => ({
              keyword: k.keyword,
              volume: k.avgMonthlySearches || 0,
              score: k.opportunityScore || 0,
            })),
          );
          // Persist clusters — replaceOne по {category, city, clusterName} (idempotent)
          for (const cluster of clusters) {
            const allKw = [cluster.headKeyword.keyword, ...cluster.supportingKeywords.map(s => s.keyword)];
            const pageType = classifyCluster(cluster.headKeyword.keyword, cluster.supportingKeywords.map(s => s.keyword));
            await KeywordCluster.collection.replaceOne(
              { category: term, city, clusterName: cluster.clusterName },
              {
                category: term,
                city,
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
          console.log(`[seoJob ${job._id}] ${term}/${city}: ${clusters.length} clusters persisted (${allForPair.length} kw input)`);

          // Stage 6: LLM overseer — quality check + suggested rename + flags
          // Graceful: если ANTHROPIC_API_KEY нет, no-op.
          try {
            const reviewStats = await reviewAndPersistClustersForPair(term, city, {
              category: contextCategory || term,
              gewerke: contextGewerke,
            });
            if (reviewStats.reviewed > 0) {
              console.log(`[seoJob ${job._id}] ${term}/${city}: LLM reviewed ${reviewStats.reviewed} clusters (${reviewStats.batches} batches)`);
            }
          } catch (revErr: any) {
            console.warn(`[seoJob ${job._id}] LLM overseer failed for ${term}/${city}: ${revErr.message}`);
          }
        }
      } catch (clusterErr: any) {
        console.warn(`[seoJob ${job._id}] clustering failed for ${term}/${city}: ${clusterErr.message}`);
      }
    } catch (e: any) {
      console.warn(`[seoJob ${job._id}] pipeline failed for ${term}/${city}: ${e.message}`);
    }
  }
}

async function processJob(jobId: mongoose.Types.ObjectId) {
  const job = await SeoJob.findById(jobId);
  if (!job || job.status !== 'running') return;

  const ids = await resolveSelection(job);
  if (job.total === 0 || job.total !== ids.length) {
    await SeoJob.updateOne({ _id: jobId }, { $set: { total: ids.length } });
    job.total = ids.length;
  }

  const useProxy = ids.length > PROXY_THRESHOLD;
  if (job.pipeline === 'full-research' && job.cursorIndex === 0) {
    await ensureAutocompleteCoverage(ids, useProxy, job);
  }

  while (true) {
    const fresh = await SeoJob.findById(jobId).lean();
    if (!fresh || fresh.status !== 'running') {
      console.log(`[seoJob ${jobId}] status=${fresh?.status}, stopping loop`);
      return;
    }

    const start = fresh.cursorIndex || 0;
    if (start >= ids.length) {
      await SeoJob.updateOne({ _id: jobId }, {
        $set: { status: 'completed', endedAt: new Date() },
      });
      emit('seo:job:end', { jobId: String(jobId), status: 'completed' });
      console.log(`[seoJob ${jobId}] completed: ${ids.length} processed`);
      return;
    }

    const batch = ids.slice(start, start + BATCH_SIZE);
    let succeeded = 0, failed = 0, skipped = 0;
    const newErrors: Array<{ providerId: string; message: string; at: Date }> = [];

    for (const pid of batch) {
      try {
        const brief = await generateContentBrief(String(pid));
        if (!brief) {
          skipped++;
          continue;
        }
        if (!brief.mainKeyword) {
          skipped++;
          continue;
        }
        succeeded++;
      } catch (e: any) {
        failed++;
        if (newErrors.length < 5) {
          newErrors.push({ providerId: String(pid), message: e.message?.slice(0, 200) || 'unknown', at: new Date() });
        }
      }
    }

    const newCursor = start + batch.length;
    const update: any = {
      $set: {
        cursorIndex: newCursor,
        heartbeatAt: new Date(),
        'progress.processed': newCursor,
      },
      $inc: {
        'progress.succeeded': succeeded,
        'progress.failed': failed,
        'progress.skipped': skipped,
      },
    };
    if (newErrors.length > 0) {
      update.$push = { errors: { $each: newErrors, $slice: -MAX_ERRORS_STORED } };
    }
    await SeoJob.updateOne({ _id: jobId }, update);

    emit('seo:job:progress', {
      jobId: String(jobId),
      processed: newCursor,
      total: ids.length,
      succeeded, failed, skipped,
    });

    if (newCursor >= ids.length) {
      await SeoJob.updateOne({ _id: jobId }, {
        $set: { status: 'completed', endedAt: new Date() },
      });
      emit('seo:job:end', { jobId: String(jobId), status: 'completed' });
      console.log(`[seoJob ${jobId}] completed: ${ids.length} processed`);
      return;
    }
  }
}

async function tickOnce() {
  if (busy) return;
  busy = true;
  try {
    const reserved = await SeoJob.findOneAndUpdate(
      { status: 'pending' },
      { $set: { status: 'running', startedAt: new Date(), heartbeatAt: new Date() } },
      { sort: { createdAt: 1 }, returnDocument: 'after' },
    );
    if (!reserved) return;

    console.log(`[seoJob] picked ${reserved._id} (pipeline=${reserved.pipeline}, kind=${reserved.selection?.kind})`);
    emit('seo:job:start', { jobId: String(reserved._id) });

    try {
      await processJob(reserved._id as mongoose.Types.ObjectId);
    } catch (e: any) {
      console.error(`[seoJob ${reserved._id}] failed:`, e);
      await SeoJob.updateOne({ _id: reserved._id }, {
        $set: {
          status: 'failed',
          endedAt: new Date(),
        },
        $push: {
          errors: { $each: [{ providerId: '', message: `worker error: ${e.message?.slice(0, 200)}`, at: new Date() }], $slice: -MAX_ERRORS_STORED },
        },
      });
      emit('seo:job:end', { jobId: String(reserved._id), status: 'failed', message: e.message });
    }
  } finally {
    busy = false;
  }
}

/**
 * При старте сервера: jobs в running с heartbeat старше 5 мин = zombie от
 * предыдущего процесса. Возвращаем в pending — следующий tick подхватит.
 */
export async function reapZombies() {
  const cutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);
  const r = await SeoJob.updateMany(
    { status: 'running', $or: [{ heartbeatAt: { $lt: cutoff } }, { heartbeatAt: { $exists: false } }] },
    { $set: { status: 'pending' } },
  );
  if (r.modifiedCount > 0) {
    console.log(`[seoJob] reaped ${r.modifiedCount} zombie jobs back to pending`);
  }
}

export function startTick() {
  if (task) return;
  task = cron.schedule('*/15 * * * * *', tickOnce, { timezone: 'Europe/Berlin' });
  console.log('[seoJob] cron tick started (every 15s)');
}

export function stopTick() {
  if (task) {
    task.stop();
    task = null;
  }
}
