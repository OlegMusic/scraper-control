import { Router } from 'express';
import { listScrapers } from '../scraper-registry.js';
import { startScraper, stopRun, listActive, tailLog } from '../process-manager.js';
import { Run } from '../db.js';

const r = Router();

r.get('/', (_req, res) => {
  res.json(listScrapers());
});

r.get('/active', (_req, res) => {
  res.json(listActive());
});

r.post('/run', async (req, res) => {
  const { scraperFile, args = [] } = req.body || {};
  if (!scraperFile || typeof scraperFile !== 'string') {
    return res.status(400).json({ error: 'scraperFile required' });
  }
  if (!Array.isArray(args)) {
    return res.status(400).json({ error: 'args must be array' });
  }
  try {
    const out = await startScraper({ scraperFile, args });
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

r.post('/stop/:runId', async (req, res) => {
  const ok = await stopRun(req.params.runId);
  res.json({ ok });
});

r.get('/log/:runId', (req, res) => {
  res.type('text/plain').send(tailLog(req.params.runId));
});

r.get('/runs', async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const runs = await Run.find().sort({ startedAt: -1 }).limit(limit).lean();
  res.json(runs);
});

export default r;
