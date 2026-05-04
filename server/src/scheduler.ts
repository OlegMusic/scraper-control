import cron, { ScheduledTask } from 'node-cron';
import { Job } from './db.js';
import { startScraper } from './process-manager.js';
import { sweepUnembedded } from './seo-pipeline/qdrantTraining.js';

const tasks = new Map<string, ScheduledTask>(); // jobId → ScheduledTask

export async function loadAndScheduleAll() {
  for (const t of tasks.values()) t.stop();
  tasks.clear();

  const jobs = await Job.find({ enabled: true, cron: { $exists: true, $ne: null } });
  for (const j of jobs) scheduleJob(j);
  console.log(`[scheduler] active cron jobs: ${tasks.size}`);

  // Системный cron: nightly retry для embedding'ов которые не проиндексировались
  // (Gemini quota out / Qdrant временно down во время POST training/feedback).
  cron.schedule('0 3 * * *', async () => {
    try {
      const r = await sweepUnembedded(200);
      if (r.processed > 0) console.log(`[scheduler] qdrant sweep: ${r.succeeded}/${r.processed} re-embedded`);
    } catch (e: any) {
      console.warn(`[scheduler] qdrant sweep failed: ${e.message}`);
    }
  }, { timezone: 'Europe/Berlin' });
  console.log('[scheduler] qdrant nightly sweep registered (03:00 Europe/Berlin)');
}

export function scheduleJob(j: any) {
  const id = String(j._id);
  if (tasks.has(id)) {
    tasks.get(id)?.stop();
    tasks.delete(id);
  }
  if (!j.enabled || !j.cron) return;
  if (!cron.validate(j.cron)) {
    console.warn(`[scheduler] invalid cron "${j.cron}" for job ${id}`);
    return;
  }
  const task = cron.schedule(j.cron, async () => {
    console.log(`[scheduler] firing ${j.label || j.scraperFile} (${j.cron})`);
    try {
      await startScraper({ scraperFile: j.scraperFile, args: j.args || [], jobId: id });
    } catch (e: any) {
      console.error(`[scheduler] start failed: ${e.message}`);
    }
  }, { timezone: 'Europe/Berlin' });
  tasks.set(id, task);
}

export function unscheduleJob(jobId: string) {
  const t = tasks.get(jobId);
  if (t) { t.stop(); tasks.delete(jobId); }
}
