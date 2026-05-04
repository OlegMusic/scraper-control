/**
 * Semantic clustering для keywords.
 *
 * Алгоритм: threshold-based agglomerative single-pass.
 *   1. Embed каждый keyword через Gemini text-embedding (768d, normalized).
 *   2. Sort кандидатов по (volume × score) desc — самый сильный keyword
 *      становится seed первого cluster'а.
 *   3. Для каждого следующего: ищем cluster чей centroid ≥ THRESHOLD по cosine.
 *      Если нашли — добавляем; иначе — новый cluster.
 *   4. Centroid = mean of cluster vectors.
 *
 * O(N×K) где K=число кластеров (~3-8 типично).
 *
 * Edge cases:
 *   - Gemini quota out → fallback: 1 cluster со всеми keywords.
 *   - N < 3 → 1 cluster по умолчанию (clustering не имеет смысла).
 *   - Все vectors несхожи (cosine < threshold) → singleton-кластеры (допустимо).
 */

import { embed } from './embeddingClient.js';

const SIMILARITY_THRESHOLD = parseFloat(process.env.SEO_CLUSTER_THRESHOLD || '0.75');
const MIN_FOR_CLUSTERING = 3;

export interface ClusterCandidate {
  keyword: string;
  volume: number;
  score: number;
  vector: number[];
}

export interface KeywordCluster {
  clusterName: string;
  headKeyword: { keyword: string; volume: number; score: number };
  supportingKeywords: Array<{
    keyword: string;
    volume: number;
    score: number;
    similarity: number;
  }>;
  volumeTotal: number;
  centroidVector: number[];
  size: number;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

/** Cosine similarity. Vectors should already be normalized but defensive math. */
export function cosine(a: number[], b: number[]): number {
  const na = norm(a), nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  return sum;
}

/**
 * Embed batch с throttle (Gemini имеет 1500/min лимит, но конкуренция за тот же
 * ключ может быть). Sequential с 50ms delay.
 */
async function embedBatch(keywords: string[]): Promise<Array<{ keyword: string; vector: number[] | null }>> {
  const out: Array<{ keyword: string; vector: number[] | null }> = [];
  for (const kw of keywords) {
    try {
      const v = await embed(kw, 'document');
      out.push({ keyword: kw, vector: v });
    } catch (e: any) {
      console.warn(`[clusterer] embed failed for "${kw}": ${e.message?.slice(0, 80)}`);
      out.push({ keyword: kw, vector: null });
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return out;
}

export interface ClusterInput {
  keyword: string;
  volume: number;
  score: number;
}

export async function clusterKeywords(items: ClusterInput[]): Promise<KeywordCluster[]> {
  if (items.length === 0) return [];

  // Edge: too few — single cluster (no real grouping)
  if (items.length < MIN_FOR_CLUSTERING) {
    const sorted = [...items].sort((a, b) => (b.volume * b.score) - (a.volume * a.score));
    const head = sorted[0];
    return [{
      clusterName: head.keyword,
      headKeyword: { keyword: head.keyword, volume: head.volume, score: head.score },
      supportingKeywords: sorted.slice(1).map(s => ({
        keyword: s.keyword, volume: s.volume, score: s.score, similarity: 1.0,
      })),
      volumeTotal: items.reduce((sum, i) => sum + i.volume, 0),
      centroidVector: [],
      size: items.length,
    }];
  }

  // Embed all (throttled)
  const embedded = await embedBatch(items.map(i => i.keyword));
  const candidates: ClusterCandidate[] = [];
  for (let i = 0; i < items.length; i++) {
    if (embedded[i].vector) {
      candidates.push({
        ...items[i],
        vector: embedded[i].vector!,
      });
    }
  }
  // Если ВСЕ embeds упали — fallback к одному cluster'у
  if (candidates.length === 0) {
    console.warn('[clusterer] all embeds failed, using fallback single-cluster');
    const sorted = [...items].sort((a, b) => (b.volume * b.score) - (a.volume * a.score));
    const head = sorted[0];
    return [{
      clusterName: head.keyword,
      headKeyword: { keyword: head.keyword, volume: head.volume, score: head.score },
      supportingKeywords: sorted.slice(1).map(s => ({
        keyword: s.keyword, volume: s.volume, score: s.score, similarity: 0,
      })),
      volumeTotal: items.reduce((sum, i) => sum + i.volume, 0),
      centroidVector: [],
      size: items.length,
    }];
  }

  // Sort by strength (head = strongest)
  candidates.sort((a, b) => (b.volume * b.score) - (a.volume * a.score));

  // Single-pass agglomerative
  const clusters: ClusterCandidate[][] = [];
  for (const cand of candidates) {
    let assigned = false;
    for (const cluster of clusters) {
      const centroid = meanVector(cluster.map(c => c.vector));
      if (cosine(cand.vector, centroid) >= SIMILARITY_THRESHOLD) {
        cluster.push(cand);
        assigned = true;
        break;
      }
    }
    if (!assigned) clusters.push([cand]);
  }

  // Format outputs — head = первый (т.е. с max volume*score)
  return clusters.map(group => {
    const centroid = meanVector(group.map(c => c.vector));
    const head = group[0];
    return {
      clusterName: head.keyword,
      headKeyword: { keyword: head.keyword, volume: head.volume, score: head.score },
      supportingKeywords: group.slice(1).map(s => ({
        keyword: s.keyword,
        volume: s.volume,
        score: s.score,
        similarity: cosine(s.vector, centroid),
      })),
      volumeTotal: group.reduce((sum, c) => sum + c.volume, 0),
      centroidVector: centroid,
      size: group.length,
    };
  });
}
