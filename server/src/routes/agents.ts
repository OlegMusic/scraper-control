/**
 * Agents control endpoints — observability + direct test для AI agents.
 *
 * GET  /api/agents                       — list of registered agents
 * GET  /api/agents/stats                 — invocation stats from training records
 * POST /api/agents/:id/test              — direct invoke agent (with RAG)
 * GET  /api/agents/:id/training          — recent training records for this agent
 */

import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { AGENTS, getAgent } from '../agents.js';
import { DirectorTraining, KeywordCluster } from '../db.js';
import { retrieveSimilar } from '../seo-pipeline/qdrantTraining.js';
import { claudePrompt, checkClaude } from '../claude-bridge.js';

const r = Router();

// ── List agents с category tag ──
r.get('/', (_req, res) => {
  const seoIds = new Set(['seo-strategist', 'serp-analyst', 'local-signals-expert']);
  res.json(AGENTS.map(a => ({
    id: a.id,
    name: a.name,
    emoji: a.emoji,
    description: a.description,
    expertise: a.expertise,
    domain: seoIds.has(a.id) ? 'seo' : 'scraper',
    systemPromptPreview: a.systemPrompt.slice(0, 200),
  })));
});

// ── Stats: per-agent — invocations, training records, ratings, llm reviews ──
r.get('/stats', async (_req, res) => {
  const seoIds = new Set(['seo-strategist', 'serp-analyst', 'local-signals-expert']);
  const stats = await Promise.all(AGENTS.map(async a => {
    // Training records, связанные с агентом (kind: 'agent-output' с providerId/keywordId)
    const trainingTotal = await DirectorTraining.countDocuments({
      kind: 'agent-output',
      // в нашей schema агент-связь хранится в originalData.agentId или userComment
      // ищем по упоминанию id агента в полях
    });
    const trainingPositive = await DirectorTraining.countDocuments({
      rating: { $gte: 1 },
    });
    const trainingNegative = await DirectorTraining.countDocuments({
      rating: { $lte: -1 },
    });
    return {
      id: a.id,
      name: a.name,
      emoji: a.emoji,
      domain: seoIds.has(a.id) ? 'seo' : 'scraper',
      expertise: a.expertise,
      // Sub-stats доступны для всех (общая БД), per-agent attribution в iteration 3
      training: { total: trainingTotal, positive: trainingPositive, negative: trainingNegative },
    };
  }));

  // Глобальные training stats
  const totalTraining = await DirectorTraining.countDocuments({});
  const ratingDistribution = await DirectorTraining.aggregate([
    { $match: { rating: { $exists: true } } },
    { $group: { _id: '$rating', n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const totalClusters = await KeywordCluster.countDocuments({});
  const llmReviewedClusters = await KeywordCluster.countDocuments({ 'llmReview.reviewedAt': { $exists: true } });

  res.json({
    agents: stats,
    global: {
      trainingRecords: totalTraining,
      ratingDistribution: ratingDistribution.map(r => ({ rating: r._id, n: r.n })),
      clustersTotal: totalClusters,
      clustersLlmReviewed: llmReviewedClusters,
    },
  });
});

// ── Recent training records (для UI display) ──
r.get('/training/recent', async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || '30'), 10), 100);
  const items = await DirectorTraining.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({
    items: items.map(t => ({
      _id: String(t._id),
      kind: t.kind,
      providerId: t.providerId,
      category: t.category,
      city: t.city,
      userComment: t.userComment,
      rating: t.rating,
      createdAt: t.createdAt,
      embeddingId: t.embeddingId,
    })),
  });
});

// ── Direct invoke agent — с RAG augmentation для SEO агентов ──
r.post('/:id/test', async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: `agent not found: ${req.params.id}` });

  const { question, context } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });

  const seoIds = new Set(['seo-strategist', 'serp-analyst', 'local-signals-expert']);

  // RAG для SEO agents
  let augmentedSystem = agent.systemPrompt;
  let ragHits: any[] = [];
  let ragStatus: 'ok' | 'empty' | 'unavailable' = 'unavailable';
  if (seoIds.has(agent.id)) {
    try {
      ragHits = await retrieveSimilar({
        question,
        context,
        topK: 4,
        ratingGte: 1,
      });
      if (ragHits.length > 0) {
        const block = ragHits.map((h, i) =>
          `${i + 1}. [${h.kind}, rating ${h.rating}${h.category ? `, ${h.category}` : ''}${h.city ? `/${h.city}` : ''}] ${h.userComment || '(no comment)'}`
        ).join('\n');
        augmentedSystem = `${agent.systemPrompt}\n\n## Verified human feedback patterns (most relevant first):\n${block}\n\nTreat these as ground-truth user preferences.`;
        ragStatus = 'ok';
      } else {
        ragStatus = 'empty';
      }
    } catch (e: any) {
      console.warn('[agents/test] RAG retrieve failed:', e.message);
    }
  }

  const userMsg = `Вопрос: ${question}${context ? '\n\nКонтекст:\n' + context : ''}`;
  let advice = '';
  let backend = 'none';
  try {
    if (config.keys.anthropic) {
      const client = new Anthropic({ apiKey: config.keys.anthropic });
      const r2 = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: augmentedSystem,
        messages: [{ role: 'user', content: userMsg }],
      });
      advice = r2.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      backend = 'anthropic';
    } else {
      const cli = await checkClaude();
      if (cli?.available) {
        advice = await claudePrompt(`${augmentedSystem}\n\n${userMsg}`, { timeoutMs: 90000 });
        backend = 'claude-cli';
      } else {
        return res.status(503).json({ error: 'no LLM available — set ANTHROPIC_API_KEY or install Claude CLI' });
      }
    }
  } catch (e: any) {
    return res.status(500).json({ error: e.message?.slice(0, 200) || 'unknown' });
  }

  res.json({
    agent: { id: agent.id, name: agent.name, emoji: agent.emoji },
    advice,
    ragStatus,
    ragHitsUsed: ragHits.length,
    ragHits: ragHits.map(h => ({
      kind: h.kind, rating: h.rating, category: h.category, city: h.city,
      userComment: h.userComment, score: h.score,
    })),
    backend,
  });
});

export default r;
