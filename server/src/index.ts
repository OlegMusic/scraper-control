import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import { config } from './config.js';
import { connectDb } from './db.js';
import { setIo } from './process-manager.js';
import { loadAndScheduleAll } from './scheduler.js';
import scrapersRoute from './routes/scrapers.js';
import jobsRoute from './routes/jobs.js';
import statsRoute from './routes/stats.js';
import settingsRoute from './routes/settings.js';
import directorRoute from './routes/director.js';
import proxyRoute from './routes/proxy.js';
import personasRoute from './routes/personas.js';
import databaseRoute from './routes/database.js';
import dbChatRoute from './routes/db-chat.js';
import seoRoute from './routes/seo.js';
import seoJobsRoute from './routes/seo-jobs.js';
import agentsRoute from './routes/agents.js';
import * as seoJobWorker from './seo-pipeline/seoJobWorker.js';
import { initCollection as initQdrant } from './seo-pipeline/qdrantTraining.js';
import { ensureIndexesAndLog } from './ensureIndexes.js';

async function main() {
  await connectDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.use('/api/scrapers', scrapersRoute);
  app.use('/api/jobs', jobsRoute);
  app.use('/api/stats', statsRoute);
  app.use('/api/settings', settingsRoute);
  app.use('/api/director', directorRoute);
  app.use('/api/proxy', proxyRoute);
  app.use('/api/personas', personasRoute);
  app.use('/api/database', databaseRoute);
  app.use('/api/db-chat', dbChatRoute);
  app.use('/api/seo', seoRoute);
  app.use('/api/seo-jobs', seoJobsRoute);
  app.use('/api/agents', agentsRoute);

  const server = http.createServer(app);
  const io = new IOServer(server, {
    cors: { origin: '*' },
  });
  setIo(io);
  seoJobWorker.setIo(io);
  io.on('connection', socket => {
    console.log(`[ws] client ${socket.id} connected`);
    socket.on('disconnect', () => console.log(`[ws] client ${socket.id} disconnected`));
  });

  await loadAndScheduleAll();
  await seoJobWorker.reapZombies();
  seoJobWorker.startTick();
  initQdrant().catch(e => console.warn('[qdrant] init error:', e.message));
  // Не await — индексы строятся в фоне, не блочат boot
  ensureIndexesAndLog();

  server.listen(config.port, '127.0.0.1', () => {
    console.log(`[server] http://127.0.0.1:${config.port}`);
    console.log(`[server] parser dir: ${config.parserDir}`);
  });
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
