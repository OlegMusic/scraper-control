/**
 * Qdrant collection `director_training_seo_v1` — vector store для feedback'а
 * пользователя на SEO briefs/keywords/agent answers.
 *
 * Pipeline:
 *   POST /api/seo/training/feedback → mongo insert → setImmediate(embedAndUpsert)
 *   → Gemini text-embedding-004 (768d) → Qdrant upsert (point id = trainingId hash)
 *
 * При вызове consult_agent('seo-strategist'/'serp-analyst'/'local-signals-expert')
 * → retrieveSimilar(question, topK=4, ratingGte=1) → блок "## Verified human
 * feedback patterns:" inj-ит в systemPrompt.
 *
 * Все операции gracefully fallback'ятся:
 *   Qdrant down       → embedAndUpsert no-op (mark embeddingId:null), retrieve []
 *   Gemini quota out  → embedAndUpsert no-op (nightly cron retry), retrieve []
 *   Empty collection  → retrieve [] (cold start)
 */

import axios from 'axios';
import { DirectorTraining } from '../db.js';
import { embed, EMBEDDING_DIM, isEmbeddingConfigured } from './embeddingClient.js';

const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
const COLLECTION = 'director_training_seo_v1';
const HTTP_TIMEOUT = 8000;

const qdrant = axios.create({ baseURL: QDRANT_URL, timeout: HTTP_TIMEOUT });

let collectionReady = false;

/** Idempotent — создаёт collection если её нет. */
export async function initCollection(): Promise<void> {
  try {
    const r = await qdrant.get(`/collections/${COLLECTION}`);
    if (r.data?.result) {
      collectionReady = true;
      console.log(`[qdrant] collection '${COLLECTION}' ready`);
      return;
    }
  } catch (e: any) {
    if (e.response?.status !== 404) {
      console.warn(`[qdrant] init check failed: ${e.message}`);
      return;
    }
  }
  try {
    await qdrant.put(`/collections/${COLLECTION}`, {
      vectors: { size: EMBEDDING_DIM, distance: 'Cosine' },
    });
    collectionReady = true;
    console.log(`[qdrant] collection '${COLLECTION}' created`);
  } catch (e: any) {
    console.warn(`[qdrant] could not create collection: ${e.message}`);
  }
}

async function ensureReady(): Promise<boolean> {
  if (!isEmbeddingConfigured()) return false;
  if (collectionReady) return true;
  await initCollection();
  return collectionReady;
}

/**
 * Mongo ObjectId → 32-char hex → 16-char hex (UInt64) для Qdrant point ID
 * (Qdrant принимает либо unsigned int либо UUID — берём первые 16 hex знаков из ObjectId).
 */
function pointId(trainingId: string): number {
  // Берём первые 12 hex знаков (48 бит) → safe positive integer.
  return parseInt(trainingId.slice(0, 12), 16);
}

/** Текст для embedding'а — kind + category + city + comment + diff. Cap длины. */
function buildEmbedText(rec: any): string {
  const parts: string[] = [];
  if (rec.kind) parts.push(`[${rec.kind}]`);
  if (rec.category) parts.push(rec.category);
  if (rec.city) parts.push(rec.city);
  if (rec.userComment) parts.push(rec.userComment);
  // diff between original and edited — берём JSON только если они разные
  try {
    if (rec.editedData && rec.originalData && JSON.stringify(rec.editedData) !== JSON.stringify(rec.originalData)) {
      parts.push(`edited: ${JSON.stringify(rec.editedData).slice(0, 1000)}`);
    } else if (rec.originalData) {
      parts.push(`data: ${JSON.stringify(rec.originalData).slice(0, 500)}`);
    }
  } catch { /* ignore */ }
  return parts.join(' | ');
}

export async function embedAndUpsert(trainingId: string): Promise<void> {
  if (!(await ensureReady())) return;
  const rec = await DirectorTraining.findById(trainingId).lean();
  if (!rec) return;
  let vec: number[];
  try {
    vec = await embed(buildEmbedText(rec), 'document');
  } catch (e: any) {
    console.warn(`[qdrant] embed failed for ${trainingId}: ${e.message}`);
    return;
  }
  try {
    await qdrant.put(`/collections/${COLLECTION}/points`, {
      points: [{
        id: pointId(trainingId),
        vector: vec,
        payload: {
          trainingId,
          kind: rec.kind,
          providerId: rec.providerId,
          category: rec.category,
          city: rec.city,
          rating: rec.rating ?? 0,
          userComment: rec.userComment ?? '',
          createdAt: rec.createdAt ? new Date(rec.createdAt).toISOString() : new Date().toISOString(),
        },
      }],
    });
    await DirectorTraining.updateOne({ _id: trainingId }, { $set: { embeddingId: String(pointId(trainingId)) } });
  } catch (e: any) {
    console.warn(`[qdrant] upsert failed for ${trainingId}: ${e.message}`);
  }
}

export interface RetrieveOpts {
  question: string;
  context?: string;
  topK?: number;
  ratingGte?: number;
}

export interface RetrievedHit {
  trainingId: string;
  kind: string;
  category?: string;
  city?: string;
  rating: number;
  userComment: string;
  createdAt: string;
  score: number;
}

/**
 * Retrieves top-K similar past feedback. Cosine score, default rating>=1
 * (только positive examples — для negative нужен второй вызов с ratingLte:-1).
 */
export async function retrieveSimilar(opts: RetrieveOpts): Promise<RetrievedHit[]> {
  if (!(await ensureReady())) return [];
  const queryText = `${opts.question} ${opts.context || ''}`.trim();
  if (!queryText) return [];

  let vec: number[];
  try {
    vec = await embed(queryText, 'query');
  } catch (e: any) {
    console.warn(`[qdrant] retrieve embed failed: ${e.message}`);
    return [];
  }

  const topK = opts.topK ?? 4;
  const ratingGte = opts.ratingGte ?? 1;

  try {
    const r = await qdrant.post(`/collections/${COLLECTION}/points/search`, {
      vector: vec,
      limit: topK,
      with_payload: true,
      filter: {
        must: [{ key: 'rating', range: { gte: ratingGte } }],
      },
    });
    const hits = (r.data?.result || []) as Array<{ id: any; score: number; payload: any }>;
    return hits.map(h => ({
      trainingId: h.payload?.trainingId,
      kind: h.payload?.kind,
      category: h.payload?.category,
      city: h.payload?.city,
      rating: h.payload?.rating ?? 0,
      userComment: h.payload?.userComment ?? '',
      createdAt: h.payload?.createdAt,
      score: h.score,
    }));
  } catch (e: any) {
    console.warn(`[qdrant] search failed: ${e.message}`);
    return [];
  }
}

/**
 * Nightly sweep — пере-embed-ит DirectorTraining записи у которых embeddingId null
 * (synchronous embed упал в момент создания, например Gemini quota была out).
 */
export async function sweepUnembedded(limit = 100): Promise<{ processed: number; succeeded: number }> {
  if (!(await ensureReady())) return { processed: 0, succeeded: 0 };
  const pending = await DirectorTraining.find({ $or: [{ embeddingId: null }, { embeddingId: { $exists: false } }] })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  let succeeded = 0;
  for (const rec of pending) {
    try {
      await embedAndUpsert(String(rec._id));
      const after = await DirectorTraining.findById(rec._id).lean();
      if (after?.embeddingId) succeeded++;
    } catch { /* logged inside */ }
    await new Promise(r => setTimeout(r, 50)); // throttle
  }
  return { processed: pending.length, succeeded };
}
