import { Router } from 'express';
import mongoose from 'mongoose';

const r = Router();

// Лёгкие read-only агрегации поверх existing parser-firecrawl коллекций
function col() { return mongoose.connection.collection('providers'); }

r.get('/overview', async (_req, res) => {
  const c = col();
  const [total, withPhone, withEmail, withWebsite, withSocials, withRadarMeta, withHwk] = await Promise.all([
    c.countDocuments({}),
    c.countDocuments({ phone: { $exists: true, $ne: '' } }),
    c.countDocuments({ 'email.0': { $exists: true } }),
    c.countDocuments({ website: { $exists: true, $ne: '' } }),
    c.countDocuments({ $or: [
      { 'socials.instagram': { $exists: true, $ne: '' } },
      { 'socials.facebook':  { $exists: true, $ne: '' } },
      { 'socials.youtube':   { $exists: true, $ne: '' } },
      { 'socials.tiktok':    { $exists: true, $ne: '' } },
    ]}),
    c.countDocuments({ radarMeta: { $exists: true } }),
    c.countDocuments({ 'radarMeta.hwkUrl': { $exists: true, $ne: '' } }),
  ]);
  res.json({ total, withPhone, withEmail, withWebsite, withSocials, withRadarMeta, withHwk });
});

r.get('/by-source', async (_req, res) => {
  const c = col();
  const result = await c.aggregate([
    { $unwind: { path: '$externalSources', preserveNullAndEmptyArrays: false } },
    { $group: { _id: '$externalSources', n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 50 },
  ]).toArray();
  res.json(result);
});

r.get('/by-city', async (_req, res) => {
  const c = col();
  const result = await c.aggregate([
    { $match: { city: { $exists: true, $ne: '' } } },
    { $group: { _id: '$city', n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 50 },
  ]).toArray();
  res.json(result);
});

r.get('/gaps', async (_req, res) => {
  const c = col();
  const [websiteNoEmail, phoneNoEmail, websiteNoSocials, hwkNoEmail] = await Promise.all([
    c.countDocuments({ website: { $exists: true, $ne: '' }, $or: [{ email: { $exists: false } }, { email: { $size: 0 } }] }),
    c.countDocuments({ phone: { $exists: true, $ne: '' },  $or: [{ email: { $exists: false } }, { email: { $size: 0 } }] }),
    c.countDocuments({ website: { $exists: true, $ne: '' }, 'socials.instagram': { $exists: false } }),
    c.countDocuments({ 'radarMeta.hwkUrl': { $exists: true, $ne: '' }, $or: [{ email: { $exists: false } }, { email: { $size: 0 } }] }),
  ]);
  res.json({ websiteNoEmail, phoneNoEmail, websiteNoSocials, hwkNoEmail });
});

// ── Live enrichment activity rate per pipeline (для dashboard) ──
// Делает 7 пар (total + last-5min) Mongo countDocuments по timestamp полям
// каждого enrichment loop'а. Результат показывает скорость live в req/min.
r.get('/enrichment-rate', async (_req, res) => {
  const c = col();
  const now = Date.now();
  const min5 = new Date(now - 5 * 60 * 1000);
  const min30 = new Date(now - 30 * 60 * 1000);
  const min60 = new Date(now - 60 * 60 * 1000);

  // Каждый loop = свой timestamp field
  const loops = [
    { id: 'radar',     label: 'Radar',          timestampField: 'updatedAt',           filter: { 'radarMeta.radarId': { $exists: true } } },
    { id: 'email',     label: 'Email Extract',  timestampField: 'updatedAt',           filter: { 'email.0': { $exists: true } } },
    { id: 'audit',     label: 'Audit',          timestampField: 'audit.auditedAt',     filter: { 'audit.version': { $exists: true } } },
    { id: 'whois',     label: 'WHOIS',          timestampField: 'whois.checkedAt',     filter: { 'whois.checkedAt': { $exists: true } } },
    { id: 'yt-api',    label: 'YouTube API',    timestampField: 'updatedAt',           filter: { ytApiScanned: true } },
    { id: 'yt-about',  label: 'YT /about',      timestampField: 'youtubeAbout.scannedAt', filter: { 'youtubeAbout.scannedAt': { $exists: true } } },
    { id: 'hwk',       label: 'HWK Gewerke',    timestampField: 'handwerkServices.scannedAt', filter: { 'handwerkServices.scannedAt': { $exists: true } } },
    { id: 'photos',    label: 'Photos+Socials', timestampField: 'updatedAt',           filter: { photosScanned: true } },
    { id: 'siteAnalysis', label: 'Site Analysis', timestampField: 'siteAnalysis.fetchedAt', filter: { 'siteAnalysis.fetchedAt': { $exists: true } } },
  ];

  const out = await Promise.all(loops.map(async l => {
    const total = await c.countDocuments(l.filter);
    const last5 = await c.countDocuments({ ...l.filter, [l.timestampField]: { $gte: min5 } });
    const last30 = await c.countDocuments({ ...l.filter, [l.timestampField]: { $gte: min30 } });
    const last60 = await c.countDocuments({ ...l.filter, [l.timestampField]: { $gte: min60 } });
    return {
      id: l.id,
      label: l.label,
      total,
      last5,
      last30,
      last60,
      ratePerMin: last5 / 5,
      // Status: active = last5>0, idle = last5=0 + last60>0, dormant = last60=0
      status: last5 > 0 ? 'active' : last60 > 0 ? 'idle' : 'dormant',
    };
  }));

  res.json({ loops: out, fetchedAt: new Date().toISOString() });
});

export default r;
