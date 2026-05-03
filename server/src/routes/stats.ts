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

export default r;
