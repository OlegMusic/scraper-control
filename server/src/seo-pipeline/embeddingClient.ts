/**
 * Gemini gemini-embedding-001 — multilingual embeddings.
 * Default dim 3072, поддерживает Matryoshka truncation через outputDimensionality.
 * Free quota: 1500 requests/min.
 *
 * Usage: const vec = await embed(text, 'document')
 * Tasks: 'document' (для индексации) | 'query' (для поиска).
 * Если GEMINI_API_KEY не сконфигурирован — кидаем явную ошибку, caller решает что делать.
 */

import axios from 'axios';
import { config } from '../config.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
const DIM = 768; // truncated through outputDimensionality (Matryoshka)

export type EmbedTask = 'document' | 'query';

const TASK_TYPES: Record<EmbedTask, string> = {
  document: 'RETRIEVAL_DOCUMENT',
  query: 'RETRIEVAL_QUERY',
};

export function isEmbeddingConfigured(): boolean {
  return !!config.keys.gemini;
}

export const EMBEDDING_DIM = DIM;

export async function embed(text: string, task: EmbedTask = 'document'): Promise<number[]> {
  if (!config.keys.gemini) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  const trimmed = (text || '').slice(0, 8000); // безопасная длина
  if (!trimmed.trim()) {
    throw new Error('embed() called with empty text');
  }
  const r = await axios.post(
    `${ENDPOINT}?key=${config.keys.gemini}`,
    {
      content: { parts: [{ text: trimmed }] },
      taskType: TASK_TYPES[task],
      outputDimensionality: DIM,
    },
    { timeout: 15000 },
  );
  const values = r.data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== DIM) {
    throw new Error(`unexpected embedding response (length=${values?.length}, expected ${DIM})`);
  }
  // Matryoshka truncation возвращает не-нормализованный вектор — нормализуем для cosine.
  const norm = Math.sqrt(values.reduce((a, v) => a + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < values.length; i++) values[i] /= norm;
  }
  return values;
}
