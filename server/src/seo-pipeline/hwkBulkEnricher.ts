/**
 * Bulk HWK Gewerke enricher — масс-fetch через IPRoyal residential proxy.
 *
 * Цель: проставить provider.handwerkServices для всех ~300K провайдеров с
 * radarMeta.hwkUrl. Это primary SEO сигнал (юридически зарегистрированные
 * Gewerke), особенно критично для провайдеров без сайта.
 *
 * Стратегия:
 *   - Concurrency=8 worker'ов
 *   - Каждый worker пользуется IPRoyal rotating proxy (новый IP per request)
 *   - Idempotent: skip провайдеров где handwerkServices.scannedAt уже есть
 *     (или старше года — тогда refresh)
 *   - Restart-safe: при перезапуске продолжает с того места (skip-pattern)
 *   - Periodic stats: каждые 10s печатает progress + ETA
 *   - Graceful SIGINT
 *
 * Запуск:
 *   npx tsx src/seo-pipeline/hwkBulkEnricher.ts                  # все
 *   npx tsx src/seo-pipeline/hwkBulkEnricher.ts --limit 1000     # batch limit
 *   npx tsx src/seo-pipeline/hwkBulkEnricher.ts --concurrency 16 # speed up
 *   npx tsx src/seo-pipeline/hwkBulkEnricher.ts --no-proxy       # без IPRoyal
 *
 * Auto-restart loop отдельно — `hwk-bulk-loop.ps1` (см. project memory pattern).
 */

import mongoose from 'mongoose';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { config } from '../config.js';
import { loadProxyConfig, buildProxyUrl } from '../proxy.js';

const HTTP_TIMEOUT = 15000;
const UA = 'Mozilla/5.0 (compatible; ScraperControl-SEO/1.0)';
const FRESHNESS_MS = 365 * 24 * 60 * 60 * 1000;

// CLI args ──
const args = process.argv.slice(2);
const argLimit = parseInt(args[args.indexOf('--limit') + 1] || '0', 10);
const argConcurrency = parseInt(args[args.indexOf('--concurrency') + 1] || '8', 10);
const argNoProxy = args.includes('--no-proxy');

// HTML utils ──
function strip(html: string): string {
  return html.replace(/<br\s*\/?>/gi, ' | ')
             .replace(/<[^>]+>/g, ' ')
             .replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
             .replace(/&szlig;/g, 'ß').replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
             .replace(/&[a-z]+;/gi, ' ')
             .replace(/\s+/g, ' ')
             .trim();
}

function parseHwkPage(html: string, url: string) {
  const patterns = [
    /<h\d[^>]*>\s*Eingetragene\s+Berufe\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
    /<h\d[^>]*>\s*Berufe\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
    /<h\d[^>]*>\s*T[äa]tigkeit(?:en)?\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
    /<h\d[^>]*>\s*Gewerk(?:e)?\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
    /<h\d[^>]*>\s*Handwerk(?:srolle)?\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i,
  ];
  let items: string[] = [];
  let matched = false;
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m[1]) {
      items = strip(m[1]).split(/\s*\|\s*|,\s*|;\s*|\n+/).map(s => s.trim()).filter(s => s.length >= 3 && s.length < 100);
      matched = true;
      break;
    }
  }
  let rawTitle: string | undefined;
  const h1 = html.match(/<h1[^>]*>([\s\S]+?)<\/h1>/i);
  if (h1 && h1[1]) {
    const t = strip(h1[1]);
    if (t.length > 1 && t.length < 200) rawTitle = t;
  }
  let rawAddress: string | undefined;
  const addr = html.match(/<h\d[^>]*>\s*Betrieb\s*<\/h\d>\s*<p[^>]*>([\s\S]+?)<\/p>/i);
  if (addr && addr[1]) {
    const t = strip(addr[1]);
    if (t.length > 5 && t.length < 400) rawAddress = t;
  }
  return {
    items,
    scannedAt: new Date(),
    source: matched ? 'hwk-odav' : 'hwk-other',
    sourceUrl: url,
    rawTitle,
    rawAddress,
  };
}

function buildAxios(useProxy: boolean) {
  if (!useProxy) return axios.create({ timeout: HTTP_TIMEOUT });
  const cfg = loadProxyConfig();
  if (!cfg) {
    console.warn('[hwk-bulk] IPRoyal config not found — running without proxy');
    return axios.create({ timeout: HTTP_TIMEOUT });
  }
  const proxyUrl = buildProxyUrl(cfg, { country: 'de', sticky: false }); // rotating
  const agent = new HttpsProxyAgent(proxyUrl);
  return axios.create({ timeout: HTTP_TIMEOUT, httpsAgent: agent, httpAgent: agent, proxy: false });
}

// ── Main loop ──
async function main() {
  await mongoose.connect(config.mongoUri, {
    bufferCommands: false,           // не буферить — сразу падать если connection lost
    maxPoolSize: 50,
    serverSelectionTimeoutMS: 8000,
  });
  console.log(`[hwk-bulk] connected: ${config.mongoUri}`);
  const col = mongoose.connection.collection('providers');

  const useProxy = !argNoProxy;
  const ax = buildAxios(useProxy);
  console.log(`[hwk-bulk] proxy=${useProxy ? 'IPRoyal-DE-rotating' : 'none'}, concurrency=${argConcurrency}, limit=${argLimit || 'all'}`);

  // ── Filter: hwkUrl exists, handwerkServices missing or stale ──
  const cutoff = new Date(Date.now() - FRESHNESS_MS);
  const filter: any = {
    'radarMeta.hwkUrl': { $exists: true, $ne: '' },
    $or: [
      { handwerkServices: { $exists: false } },
      { 'handwerkServices.scannedAt': { $lt: cutoff } },
      { 'handwerkServices.source': 'hwk-failed' }, // retry failed
    ],
  };

  const total = await col.countDocuments(filter);
  console.log(`[hwk-bulk] todo: ${total.toLocaleString()}`);
  if (total === 0) { console.log('[hwk-bulk] nothing to do'); await mongoose.disconnect(); return; }

  let processed = 0, succeeded = 0, withGewerke = 0, failed = 0, skipped = 0;
  const startTs = Date.now();
  let stopped = false;

  process.on('SIGINT', () => { console.log('\n[hwk-bulk] SIGINT — finishing in-flight...'); stopped = true; });
  process.on('SIGTERM', () => { stopped = true; });

  // Stats ticker
  const statsInterval = setInterval(() => {
    const elapsedSec = (Date.now() - startTs) / 1000;
    const rate = processed / Math.max(1, elapsedSec);
    const remaining = total - processed;
    const etaMin = Math.ceil(remaining / Math.max(0.01, rate) / 60);
    console.log(`[hwk-bulk] processed=${processed.toLocaleString()}/${total.toLocaleString()} (${(100 * processed / total).toFixed(1)}%) gewerke=${withGewerke} failed=${failed} skipped=${skipped} rate=${rate.toFixed(1)}/s ETA=${etaMin}min`);
  }, 10000);

  // ── Atomic claim per doc — race-safe для multi-worker concurrency ──
  // Каждый worker через findOneAndUpdate помечает doc как 'in-progress', получая
  // его эксклюзивно. Другие workers не увидят его в filter (поле теперь есть, но
  // source='in-progress' исключён из retry-filter). После fetch worker записывает
  // финальный source ('hwk-odav' / 'hwk-failed' / etc).
  //
  // Если worker умрёт — doc застрянет в 'in-progress'. Reclaim filter ловит
  // 'in-progress' старше 5 минут и переоткрывает их.
  const inProgressRecoveryMs = 5 * 60 * 1000;

  async function claimNext(): Promise<{ _id: any; url: string } | null> {
    if (argLimit > 0 && processed >= argLimit) return null;
    const recoveryCutoff = new Date(Date.now() - inProgressRecoveryMs);
    const r = await col.findOneAndUpdate(
      {
        'radarMeta.hwkUrl': { $exists: true, $ne: '' },
        $or: [
          { handwerkServices: { $exists: false } },
          { 'handwerkServices.source': 'hwk-failed' },
          { 'handwerkServices.scannedAt': { $lt: cutoff } },
          // reclaim stuck in-progress (worker умер mid-fetch)
          { 'handwerkServices.source': 'in-progress', 'handwerkServices.scannedAt': { $lt: recoveryCutoff } },
        ],
      },
      {
        $set: {
          handwerkServices: {
            items: [],
            scannedAt: new Date(),
            source: 'in-progress',
            sourceUrl: '',
          },
        },
      },
      {
        returnDocument: 'before',
        projection: { _id: 1, 'radarMeta.hwkUrl': 1 },
      },
    );
    if (!r) return null;
    const url = r.radarMeta?.hwkUrl;
    if (typeof url !== 'string' || !url) {
      // нет URL — финализируем как failed
      await col.updateOne({ _id: r._id }, {
        $set: { handwerkServices: { items: [], scannedAt: new Date(), source: 'hwk-failed', sourceUrl: '' } },
      }).catch(() => {});
      skipped++;
      processed++;
      return claimNext();
    }
    return { _id: r._id, url };
  }

  async function processOne(item: { _id: any; url: string }) {
    try {
      const r = await ax.get(item.url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
        maxRedirects: 5,
        responseType: 'text',
        transformResponse: [(d) => d],
        validateStatus: s => s < 500,
      });
      if (r.status >= 400) {
        await col.updateOne({ _id: item._id }, {
          $set: { handwerkServices: { items: [], scannedAt: new Date(), source: 'hwk-failed', sourceUrl: item.url } },
        });
        failed++;
      } else {
        const parsed = parseHwkPage(String(r.data || ''), item.url);
        await col.updateOne({ _id: item._id }, { $set: { handwerkServices: parsed } });
        if (parsed.items.length > 0) withGewerke++;
        succeeded++;
      }
    } catch (e: any) {
      await col.updateOne({ _id: item._id }, {
        $set: { handwerkServices: { items: [], scannedAt: new Date(), source: 'hwk-failed', sourceUrl: item.url } },
      }).catch(() => {});
      failed++;
    }
    processed++;
  }

  async function worker() {
    while (!stopped) {
      if (argLimit > 0 && processed >= argLimit) { stopped = true; return; }
      const item = await claimNext();
      if (!item) return;
      await processOne(item);
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    }
  }

  const workers = Array.from({ length: argConcurrency }, () => worker());
  await Promise.all(workers);
  clearInterval(statsInterval);

  const elapsed = Math.round((Date.now() - startTs) / 1000);
  console.log(`\n[hwk-bulk] DONE in ${elapsed}s`);
  console.log(`[hwk-bulk] processed=${processed} succeeded=${succeeded} (with-gewerke=${withGewerke}) failed=${failed} skipped=${skipped}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error('[hwk-bulk] FATAL', e); process.exit(1); });
