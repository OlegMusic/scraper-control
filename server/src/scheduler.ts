import cron, { ScheduledTask } from 'node-cron';
import { Job } from './db.js';
import { startScraper } from './process-manager.js';

const tasks = new Map<string, ScheduledTask>(); // jobId → ScheduledTask

export async function loadAndScheduleAll() {
  for (const t of tasks.values()) t.stop();
  tasks.clear();

  const jobs = await Job.find({ enabled: true, cron: { $exists: true, $ne: null } });
  for (const j of jobs) scheduleJob(j);
  console.log(`[scheduler] active cron jobs: ${tasks.size}`);
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
