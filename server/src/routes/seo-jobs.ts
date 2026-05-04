/**
 * Bulk SEO research jobs CRUD.
 *
 * POST   /api/seo-jobs                 — создать job
 * GET    /api/seo-jobs?status=running  — список
 * GET    /api/seo-jobs/:id             — детали + progress
 * POST   /api/seo-jobs/:id/pause
 * POST   /api/seo-jobs/:id/resume
 * POST   /api/seo-jobs/:id/cancel
 *
 * Worker (seoJobWorker.ts) подхватывает status='pending' с интервалом 15s.
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { SeoJob } from '../db.js';
import { TARGETS } from './database.js';

const r = Router();

const PROXY_THRESHOLD = 1000;
const MANUAL_CAP = 500;

r.post('/', async (req, res) => {
  const body = req.body || {};
  const sel = body.selection;
  if (!sel || !sel.kind) return res.status(400).json({ error: 'selection.kind required' });

  let total = 0;
  if (sel.kind === 'smart-target') {
    const t = TARGETS.find(x => x.id === sel.targetId);
    if (!t) return res.status(404).json({ error: `smart-target '${sel.targetId}' not found` });
    total = await mongoose.connection.collection('providers').countDocuments(t.query);
  } else if (sel.kind === 'manual') {
    const ids: string[] = Array.isArray(sel.providerIds) ? sel.providerIds : [];
    if (ids.length === 0) return res.status(400).json({ error: 'providerIds required for manual' });
    if (ids.length > MANUAL_CAP) return res.status(400).json({ error: `manual selection max ${MANUAL_CAP}, got ${ids.length}` });
    total = ids.length;
  } else {
    return res.status(400).json({ error: `unknown selection.kind '${sel.kind}'` });
  }

  const pipeline = body.pipeline === 'full-research' ? 'full-research' : 'brief-only';
  const useProxy = total > PROXY_THRESHOLD;

  const job = await SeoJob.create({
    label: body.label,
    selection: {
      kind: sel.kind,
      targetId: sel.targetId,
      providerIds: sel.kind === 'manual'
        ? sel.providerIds.map((id: string) => new mongoose.Types.ObjectId(id))
        : undefined,
    },
    pipeline,
    status: 'pending',
    total,
    rateLimit: { perMinute: 60, useProxy },
  });

  res.json({ ok: true, jobId: String(job._id), total, useProxy });
});

r.get('/', async (req, res) => {
  const filter: any = {};
  if (req.query.status) filter.status = String(req.query.status);
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const items = await SeoJob.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({
    items: items.map(j => ({
      _id: String(j._id),
      label: j.label,
      pipeline: j.pipeline,
      status: j.status,
      total: j.total,
      progress: j.progress,
      cursorIndex: j.cursorIndex,
      selection: { kind: j.selection?.kind, targetId: j.selection?.targetId, providerCount: j.selection?.providerIds?.length },
      rateLimit: j.rateLimit,
      startedAt: j.startedAt,
      endedAt: j.endedAt,
      heartbeatAt: j.heartbeatAt,
      createdAt: j.createdAt,
      errorCount: j.errors?.length || 0,
    })),
  });
});

r.get('/:id', async (req, res) => {
  const job = await SeoJob.findById(req.params.id).lean();
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json({
    ...job,
    _id: String(job._id),
    selection: {
      kind: job.selection?.kind,
      targetId: job.selection?.targetId,
      providerIds: job.selection?.providerIds?.map(String),
    },
  });
});

async function flipStatus(jobId: string, expected: string[], next: string) {
  const job = await SeoJob.findById(jobId);
  if (!job) return { ok: false, code: 404, error: 'not found' };
  if (!expected.includes(job.status as string)) {
    return { ok: false, code: 409, error: `cannot transition from ${job.status} → ${next}` };
  }
  job.status = next as any;
  if (next === 'cancelled') job.endedAt = new Date();
  await job.save();
  return { ok: true, status: next };
}

r.post('/:id/pause', async (req, res) => {
  const r2 = await flipStatus(req.params.id, ['running', 'pending'], 'paused');
  if (!r2.ok) return res.status(r2.code!).json(r2);
  res.json(r2);
});

r.post('/:id/resume', async (req, res) => {
  const r2 = await flipStatus(req.params.id, ['paused'], 'pending');
  if (!r2.ok) return res.status(r2.code!).json(r2);
  res.json(r2);
});

r.post('/:id/cancel', async (req, res) => {
  const r2 = await flipStatus(req.params.id, ['pending', 'running', 'paused'], 'cancelled');
  if (!r2.ok) return res.status(r2.code!).json(r2);
  res.json(r2);
});

export default r;
