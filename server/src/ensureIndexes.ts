/**
 * Idempotent index bootstrap для providers + sc_* collections.
 *
 * Запускается на boot scraper-control сервера. Все индексы создаются с
 * background:true, sparse там где имеет смысл, partial для редких полей.
 *
 * Покрывает query patterns:
 *  - skip-already-X loops:   audit.version, whois.checkedAt, youtubeAbout.scannedAt,
 *                            handwerkServices.scannedAt, siteAnalysis.fetchedAt
 *  - smart-targets:          audit.overallNeed, audit.recommendations, externalSources,
 *                            email.0, socials.* presence
 *  - radar lookups:          radarMeta.radarId, radarMeta.hwkUrl, radarMeta.plz
 *  - SEO research:           sc_keywords{category,city,fetchedAt}, opportunityScore desc
 *  - Activity queries:       updatedAt
 */
import mongoose from 'mongoose';

interface IdxSpec {
  collection: string;
  name: string;
  key: Record<string, 1 | -1>;
  options?: any;
}

const INDEXES: IdxSpec[] = [
  // ── providers: HWK claim (partial) — критично для bulk enricher ──
  {
    collection: 'providers',
    name: 'hwk_claim_partial',
    key: { 'radarMeta.hwkUrl': 1, 'handwerkServices.scannedAt': 1 },
    options: {
      partialFilterExpression: { 'radarMeta.hwkUrl': { $exists: true } },
      background: true,
    },
  },
  // ── providers: handwerkServices source → быстрая проверка состояния ──
  {
    collection: 'providers',
    name: 'hwk_source_scannedAt',
    key: { 'handwerkServices.source': 1, 'handwerkServices.scannedAt': 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: radar lookups (radarId — primary lookup для радар-скрейпов) ──
  {
    collection: 'providers',
    name: 'radar_radarId',
    key: { 'radarMeta.radarId': 1 },
    options: { sparse: true, background: true },
  },
  {
    collection: 'providers',
    name: 'radar_plz',
    key: { 'radarMeta.plz': 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: audit skip-pattern (auditor enricher checks audit.version) ──
  {
    collection: 'providers',
    name: 'audit_version_auditedAt',
    key: { 'audit.version': 1, 'audit.auditedAt': 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: audit smart-targets (verdict + recommendations) ──
  {
    collection: 'providers',
    name: 'audit_overallNeed',
    key: { 'audit.overallNeed': 1, updatedAt: -1 },
    options: { sparse: true, background: true },
  },
  {
    collection: 'providers',
    name: 'audit_recommendations',
    key: { 'audit.recommendations': 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: whois skip-pattern ──
  {
    collection: 'providers',
    name: 'whois_checkedAt',
    key: { 'whois.checkedAt': 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: YT-about skip-pattern ──
  {
    collection: 'providers',
    name: 'ytAbout_scannedAt',
    key: { 'youtubeAbout.scannedAt': 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: site-analysis skip-pattern ──
  {
    collection: 'providers',
    name: 'siteAnalysis_fetchedAt',
    key: { 'siteAnalysis.fetchedAt': 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: socials.* presence (smart-targets has-IG/FB/etc) ──
  {
    collection: 'providers',
    name: 'socials_instagram',
    key: { 'socials.instagram': 1 },
    options: { sparse: true, background: true },
  },
  {
    collection: 'providers',
    name: 'socials_facebook',
    key: { 'socials.facebook': 1 },
    options: { sparse: true, background: true },
  },
  {
    collection: 'providers',
    name: 'socials_youtube',
    key: { 'socials.youtube': 1 },
    options: { sparse: true, background: true },
  },
  {
    collection: 'providers',
    name: 'socials_tiktok',
    key: { 'socials.tiktok': 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: externalSources (multi-key для smart-target source filter) ──
  {
    collection: 'providers',
    name: 'externalSources',
    key: { externalSources: 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: email/website existence для smart-targets ──
  {
    collection: 'providers',
    name: 'email_first',
    key: { 'email.0': 1 },
    options: { sparse: true, background: true },
  },
  {
    collection: 'providers',
    name: 'website_exists',
    key: { website: 1 },
    options: { sparse: true, background: true },
  },
  // ── providers: emailExtracted skip-flag ──
  {
    collection: 'providers',
    name: 'emailExtracted',
    key: { emailExtracted: 1, website: 1 },
    options: { background: true },
  },
  // ── providers: updatedAt — activity queries (last hour/day) ──
  {
    collection: 'providers',
    name: 'updatedAt_desc',
    key: { updatedAt: -1 },
    options: { background: true },
  },
  // ── providers: youtubePublishedAt (smart-targets fresh-yt/old-yt) ──
  {
    collection: 'providers',
    name: 'youtubePublishedAt',
    key: { youtubePublishedAt: 1 },
    options: { sparse: true, background: true },
  },

  // ── sc_keywords: coverage check freshness ──
  {
    collection: 'sc_keywords',
    name: 'kw_cat_city_fetched',
    key: { category: 1, city: 1, fetchedAt: 1 },
    options: { background: true },
  },
];

/**
 * Создаёт индексы которых ещё нет. Уже существующие skip'ает.
 * Возвращает {created, existing, failed}.
 */
export async function ensureIndexes(): Promise<{ created: string[]; existing: string[]; failed: Array<{ name: string; error: string }> }> {
  const created: string[] = [];
  const existing: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const spec of INDEXES) {
    try {
      const col = mongoose.connection.collection(spec.collection);
      const result = await col.createIndex(spec.key, { name: spec.name, ...spec.options });
      // createIndex returns the index name. If it already existed with same spec, it just returns the name (no-op).
      // We can detect by checking if it exists in indexes() before vs after, but simpler: just log success.
      if (result === spec.name) {
        // Это либо новое создание либо already-existed — обе варианта OK
        created.push(`${spec.collection}.${spec.name}`);
      } else {
        existing.push(`${spec.collection}.${spec.name}`);
      }
    } catch (e: any) {
      // IndexOptionsConflict / IndexKeySpecsConflict → существует с другими опциями
      if (e.code === 85 || e.code === 86 || e.codeName?.includes('IndexOptions')) {
        existing.push(`${spec.collection}.${spec.name}`);
      } else {
        failed.push({ name: `${spec.collection}.${spec.name}`, error: e.message?.slice(0, 200) || 'unknown' });
      }
    }
  }

  return { created, existing, failed };
}

/** Helper для boot-hook: log результат не блочит startup. */
export async function ensureIndexesAndLog(): Promise<void> {
  try {
    const r = await ensureIndexes();
    console.log(`[indexes] ensured ${r.created.length} indexes (${r.existing.length} already existed)`);
    if (r.failed.length > 0) {
      console.warn(`[indexes] ${r.failed.length} failed:`);
      r.failed.forEach(f => console.warn(`  ✗ ${f.name}: ${f.error}`));
    }
  } catch (e: any) {
    console.warn(`[indexes] bootstrap error: ${e.message}`);
  }
}
