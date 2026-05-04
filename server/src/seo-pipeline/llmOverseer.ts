/**
 * LLM Overseer — AI quality-gate.
 *
 * Запускается ПОСЛЕ clustering (или можно ad-hoc) и автоматически:
 *   1. Оценивает quality score каждого cluster'а (0-10)
 *   2. Предлагает human-readable cluster name (вместо raw head keyword)
 *   3. Refine pageType (LLM умнее regex-эвристики)
 *   4. Flags: 'incoherent' / 'spam' / 'mixed-intent' / 'irrelevant-brands'
 *   5. 1-line note для UI ("Группа про цены, можно делать pricing-страницу")
 *
 * Batch: один запрос Haiku 4.5 на 5 кластеров за раз, JSON output.
 * Stored: cluster.llmReview {qualityScore, suggestedName, refinedPageType, flags, notes, reviewedAt}.
 *
 * Graceful: если ANTHROPIC_API_KEY нет — no-op, кластеры остаются без llmReview.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { KeywordCluster } from '../db.js';
import { claudePrompt, checkClaude } from '../claude-bridge.js';

const BATCH_SIZE = 5;

export interface ClusterForReview {
  _id: any;
  category: string;
  city: string;
  clusterName: string;
  headKeyword: { keyword: string };
  supportingKeywords: Array<{ keyword: string }>;
  pageType: string;
}

export interface LlmReview {
  qualityScore: number;             // 0-10
  suggestedName: string;
  refinedPageType: 'service-page' | 'pricing' | 'faq' | 'job-page' | 'general';
  flags: string[];
  notes: string;
}

interface ProviderContext {
  category: string;
  city: string;
  gewerke?: string[];
}

let _claudeCliAvailable: boolean | null = null;
async function isClaudeCliAvailable(): Promise<boolean> {
  if (_claudeCliAvailable !== null) return _claudeCliAvailable;
  try {
    const status = await checkClaude();
    _claudeCliAvailable = !!status?.available;
  } catch {
    _claudeCliAvailable = false;
  }
  return _claudeCliAvailable;
}

async function isAvailable(): Promise<boolean> {
  if (config.keys.anthropic) return true;
  return isClaudeCliAvailable();
}

function buildPrompt(clusters: ClusterForReview[], ctx: ProviderContext): string {
  const lines: string[] = [];
  lines.push(`Provider context: category="${ctx.category}", city="${ctx.city}"${ctx.gewerke?.length ? `, HWK Gewerke=[${ctx.gewerke.join(', ')}]` : ''}.`);
  lines.push(``);
  lines.push(`Review the following German Handwerker keyword clusters. For each cluster output JSON with:`);
  lines.push(`  qualityScore (0-10, how coherent + commercially relevant)`);
  lines.push(`  suggestedName (short human-readable label in German, e.g. "Maler-Preise Kassel")`);
  lines.push(`  refinedPageType (one of: service-page, pricing, faq, job-page, general)`);
  lines.push(`  flags (any of: incoherent, spam, mixed-intent, irrelevant-brands, foreign-language; or empty array)`);
  lines.push(`  notes (1 sentence, German, what this cluster is about)`);
  lines.push(``);
  lines.push(`Output ONLY a JSON array with one entry per cluster, in the same order. No markdown, no commentary.`);
  lines.push(``);
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const all = [c.headKeyword.keyword, ...c.supportingKeywords.slice(0, 12).map(s => s.keyword)];
    lines.push(`Cluster #${i + 1} (currentName="${c.clusterName}", currentPageType="${c.pageType}"):`);
    for (const kw of all) lines.push(`  - ${kw}`);
    lines.push(``);
  }
  return lines.join('\n');
}

function tryParseJson(text: string): any[] | null {
  // Strip code fences if present
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
  // Find first JSON array
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrMatch) return null;
  try {
    const parsed = JSON.parse(arrMatch[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Validate single review object — defensive, possibly LLM returned partial. */
function normalizeReview(raw: any): LlmReview {
  const validPageTypes = ['service-page', 'pricing', 'faq', 'job-page', 'general'];
  return {
    qualityScore: Math.max(0, Math.min(10, Number(raw?.qualityScore) || 5)),
    suggestedName: String(raw?.suggestedName || '').slice(0, 100) || '',
    refinedPageType: validPageTypes.includes(raw?.refinedPageType) ? raw.refinedPageType : 'service-page',
    flags: Array.isArray(raw?.flags) ? raw.flags.filter((f: any) => typeof f === 'string').slice(0, 5) : [],
    notes: String(raw?.notes || '').slice(0, 300),
  };
}

/**
 * Review batch of clusters. Returns one review per cluster, in same order.
 * On error returns empty array (caller skips llmReview update).
 *
 * Backend selection:
 *   1. ANTHROPIC_API_KEY → official SDK (preferred, fast)
 *   2. Иначе Claude CLI subprocess (free через subscription, slower)
 *   3. Если ничего нет — возвращает []
 */
export async function reviewBatch(clusters: ClusterForReview[], ctx: ProviderContext): Promise<LlmReview[]> {
  if (clusters.length === 0) return [];
  if (!(await isAvailable())) return [];

  const prompt = buildPrompt(clusters, ctx);
  const SYSTEM = 'You are a German SEO quality reviewer. Output strict JSON only — no markdown, no preamble.';

  try {
    let text = '';
    if (config.keys.anthropic) {
      const client = new Anthropic({ apiKey: config.keys.anthropic });
      const r = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: clusters.length * 250 + 200,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      });
      text = r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    } else {
      // Claude CLI fallback. Inject system instruction в начало prompt'а.
      const fullPrompt = `${SYSTEM}\n\n${prompt}`;
      text = await claudePrompt(fullPrompt, { timeoutMs: 90000 });
    }

    const parsed = tryParseJson(text);
    if (!parsed || parsed.length !== clusters.length) {
      console.warn(`[llmOverseer] expected ${clusters.length} reviews, got ${parsed?.length || 0}`);
      return [];
    }
    return parsed.map(normalizeReview);
  } catch (e: any) {
    console.warn('[llmOverseer] batch review failed:', e.message?.slice(0, 200));
    return [];
  }
}

/**
 * Review and persist для пары (category, city). Использовать после clustering.
 * Возвращает stats {reviewed, batchCount}.
 */
export async function reviewAndPersistClustersForPair(category: string, city: string, ctx?: Partial<ProviderContext>): Promise<{ reviewed: number; batches: number }> {
  if (!(await isAvailable())) return { reviewed: 0, batches: 0 };

  // Берём только не-просмотренные cluster'ы (idempotent)
  const clusters = await KeywordCluster.find({
    category, city,
    $or: [{ 'llmReview.reviewedAt': { $exists: false } }, { 'llmReview.reviewedAt': null }],
  }).lean();
  if (clusters.length === 0) return { reviewed: 0, batches: 0 };

  const fullCtx: ProviderContext = {
    category: ctx?.category || category,
    city,
    gewerke: ctx?.gewerke,
  };

  let totalReviewed = 0;
  let batchCount = 0;
  for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
    const chunk = clusters.slice(i, i + BATCH_SIZE);
    const reviews = await reviewBatch(chunk as any, fullCtx);
    if (reviews.length === chunk.length) {
      for (let j = 0; j < chunk.length; j++) {
        await KeywordCluster.updateOne({ _id: chunk[j]._id }, {
          $set: {
            llmReview: { ...reviews[j], reviewedAt: new Date() },
          },
        });
        totalReviewed++;
      }
      batchCount++;
    }
  }
  return { reviewed: totalReviewed, batches: batchCount };
}
