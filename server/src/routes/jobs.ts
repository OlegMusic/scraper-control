import { Router } from 'express';
import cron from 'node-cron';
import { Job } from '../db.js';
import { scheduleJob, unscheduleJob } from '../scheduler.js';

const r = Router();

r.get('/', async (_req, res) => {
  const jobs = await Job.find().sort({ updatedAt: -1 }).lean();
  res.json(jobs);
});

r.post('/', async (req, res) => {
  const { scraperFile, args = [], cron: cronExpr, enabled = true, label } = req.body || {};
  if (!scraperFile) return res.status(400).json({ error: 'scraperFile required' });
  if (cronExpr && !cron.validate(cronExpr)) {
    return res.status(400).json({ error: `invalid cron: ${cronExpr}` });
  }
  const job = await Job.create({ scraperFile, args, cron: cronExpr, enabled, label });
  scheduleJob(job);
  res.json(job);
});

r.put('/:id', async (req, res) => {
  const { args, cron: cronExpr, enabled, label } = req.body || {};
  if (cronExpr && !cron.validate(cronExpr)) {
    return res.status(400).json({ error: `invalid cron: ${cronExpr}` });
  }
  const upd: any = { updatedAt: new Date() };
  if (args !== undefined) upd.args = args;
  if (cronExpr !== undefined) upd.cron = cronExpr;
  if (enabled !== undefined) upd.enabled = enabled;
  if (label !== undefined) upd.label = label;
  const job = await Job.findByIdAndUpdate(req.params.id, { $set: upd }, { new: true });
  if (!job) return res.status(404).json({ error: 'not found' });
  scheduleJob(job);
  res.json(job);
});

r.delete('/:id', async (req, res) => {
  unscheduleJob(req.params.id);
  await Job.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default r;
