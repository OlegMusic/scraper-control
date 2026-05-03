import { Router } from 'express';
import mongoose from 'mongoose';

const r = Router();
function col() { return mongoose.connection.collection('providers'); }

// ── Browser providers с фильтрами + пагинацией ─────────────────────────────
r.get('/providers', async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const skip = parseInt(String(req.query.skip || '0'), 10);
  const q: any = {};

  // Фильтры
  if (req.query.city) q.city = { $regex: String(req.query.city), $options: 'i' };
  if (req.query.category) q.category = { $regex: String(req.query.category), $options: 'i' };
  if (req.query.source) q.externalSources = String(req.query.source);
  if (req.query.name) q.name = { $regex: String(req.query.name), $options: 'i' };

  // Has-фильтры
  if (req.query.hasEmail === 'true') q['email.0'] = { $exists: true };
  if (req.query.hasEmail === 'false') q.$or = [{ email: { $exists: false } }, { email: { $size: 0 } }];
  if (req.query.hasWebsite === 'true') q.website = { $exists: true, $ne: '' };
  if (req.query.hasWebsite === 'false') q.$or = [...(q.$or || []), { website: { $exists: false } }, { website: '' }];
  if (req.query.hasSocials === 'true') {
    q.$or = [
      { 'socials.instagram': { $exists: true, $ne: '' } },
      { 'socials.facebook':  { $exists: true, $ne: '' } },
      { 'socials.youtube':   { $exists: true, $ne: '' } },
      { 'socials.tiktok':    { $exists: true, $ne: '' } },
    ];
  }
  if (req.query.hasYoutubeDate === 'true') q.youtubePublishedAt = { $exists: true };

  // Sort
  let sort: any = { updatedAt: -1 };
  if (req.query.sort === 'oldest') sort = { youtubePublishedAt: 1 };
  if (req.query.sort === 'newest') sort = { youtubePublishedAt: -1 };
  if (req.query.sort === 'name') sort = { name: 1 };

  const projection = {
    name: 1, phone: 1, email: 1, website: 1, socials: 1,
    address: 1, city: 1, category: 1, externalSources: 1,
    youtubePublishedAt: 1, youtubeChannelTitle: 1, youtubeChannelDescription: 1,
    youtubeSubscribers: 1, youtubeVideoCount: 1, youtubeViewCount: 1, youtubeCountry: 1,
    radarMeta: 1, rating: 1, ratingCount: 1, photos: 1,
    createdAt: 1, updatedAt: 1, source: 1,
    audit: 1, whois: 1, avatarUrl: 1,
  };

  const [total, items] = await Promise.all([
    col().countDocuments(q),
    col().find(q, { projection }).sort(sort).skip(skip).limit(limit).toArray(),
  ]);

  res.json({ total, items });
});

// ── Произвольный query (Stats drill-down) — read-only, sanitized ──
r.post('/query', async (req, res) => {
  const q = req.body?.query || {};
  const sort = req.body?.sort || { updatedAt: -1 };
  const limit = Math.min(parseInt(String(req.body?.limit || '25')), 200);
  const skip = parseInt(String(req.body?.skip || '0'), 10);

  const dangerous = /\$where|\$function|\$accumulator/.test(JSON.stringify(q));
  if (dangerous) return res.status(400).json({ error: 'forbidden operator' });

  const projection = {
    name: 1, phone: 1, email: 1, website: 1, socials: 1,
    address: 1, city: 1, category: 1, externalSources: 1,
    youtubePublishedAt: 1, audit: 1, whois: 1, radarMeta: 1, photos: 1,
  };
  const [total, items] = await Promise.all([
    col().countDocuments(q),
    col().find(q, { projection }).sort(sort).skip(skip).limit(limit).toArray(),
  ]);
  res.json({ total, items });
});

// ── Single provider full ──
r.get('/providers/:id', async (req, res) => {
  let _id: any = req.params.id;
  try {
    if (mongoose.Types.ObjectId.isValid(_id)) _id = new mongoose.Types.ObjectId(_id);
  } catch {}
  const item = await col().findOne({ $or: [{ _id }, { googlePlaceId: req.params.id }] });
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

// ── Расширенные метрики (кэш 60 секунд для ускорения) ──────────────────────
let metricsCache: { ts: number; data: any } | null = null;
const METRICS_TTL_MS = 60_000;

r.get('/metrics', async (_req, res) => {
  if (metricsCache && Date.now() - metricsCache.ts < METRICS_TTL_MS) {
    return res.json(metricsCache.data);
  }
  const c = col();

  // Параллельно — много countDocuments
  const [
    total,
    handwerker,        // не researcher
    researchers,
    weakSite,          // website = '' или нет
    noEmail,
    noPhone,
    noSocials,
    noPhotos,
    noRating,
    weakAll,           // совсем слабые: ни email, ни website, ни socials
    youtubeWithDate,
    websiteAndSocials,
    fullData,          // имеет всё: phone, email, website, socials
  ] = await Promise.all([
    c.countDocuments({}),
    c.countDocuments({ externalSources: { $nin: ['openalex', 'orcid', 'github', 'gnd'] } }),
    c.countDocuments({ externalSources: { $in: ['openalex', 'orcid', 'github', 'gnd'] } }),
    c.countDocuments({ $or: [{ website: '' }, { website: { $exists: false } }] }),
    c.countDocuments({ $or: [{ email: { $size: 0 } }, { email: { $exists: false } }] }),
    c.countDocuments({ $or: [{ phone: '' }, { phone: { $exists: false } }] }),
    c.countDocuments({
      $and: [
        { $or: [{ 'socials.instagram': { $exists: false } }, { 'socials.instagram': '' }] },
        { $or: [{ 'socials.facebook': { $exists: false } }, { 'socials.facebook': '' }] },
        { $or: [{ 'socials.youtube': { $exists: false } }, { 'socials.youtube': '' }] },
      ],
    }),
    c.countDocuments({ $or: [{ photos: { $size: 0 } }, { photos: { $exists: false } }] }),
    c.countDocuments({ $or: [{ rating: 0 }, { rating: { $exists: false } }] }),
    c.countDocuments({
      $and: [
        { $or: [{ website: '' }, { website: { $exists: false } }] },
        { $or: [{ email: { $size: 0 } }, { email: { $exists: false } }] },
        { 'socials.instagram': { $exists: false } },
        { 'socials.facebook': { $exists: false } },
      ],
    }),
    c.countDocuments({ youtubePublishedAt: { $exists: true } }),
    c.countDocuments({
      website: { $exists: true, $ne: '' },
      $or: [
        { 'socials.instagram': { $exists: true, $ne: '' } },
        { 'socials.facebook':  { $exists: true, $ne: '' } },
      ],
    }),
    c.countDocuments({
      phone: { $exists: true, $ne: '' },
      'email.0': { $exists: true },
      website: { $exists: true, $ne: '' },
      'socials.instagram': { $exists: true, $ne: '' },
    }),
  ]);

  // Возрастные группы YouTube каналов
  const ageGroups = await c.aggregate([
    { $match: { youtubePublishedAt: { $exists: true } } },
    { $project: {
      ageYears: { $divide: [{ $subtract: [new Date(), '$youtubePublishedAt'] }, 1000 * 60 * 60 * 24 * 365] },
    }},
    { $bucket: {
      groupBy: '$ageYears',
      boundaries: [0, 1, 2, 3, 5, 10, 20, 30],
      default: '30+',
      output: { n: { $sum: 1 } },
    }},
  ]).toArray();

  // Audit metrics
  const [auditTotal, auditCritical, auditMajor, auditMinor, auditNone, auditedRecently] = await Promise.all([
    c.countDocuments({ 'audit.auditedAt': { $exists: true } }),
    c.countDocuments({ 'audit.overallNeed': 'critical' }),
    c.countDocuments({ 'audit.overallNeed': 'major' }),
    c.countDocuments({ 'audit.overallNeed': 'minor' }),
    c.countDocuments({ 'audit.overallNeed': 'none' }),
    c.countDocuments({ 'audit.auditedAt': { $gt: new Date(Date.now() - 7 * 86400000) } }),
  ]);

  // WHOIS metrics
  const [whoisTotal, whoisYoung, whoisOld] = await Promise.all([
    c.countDocuments({ 'whois.registered': { $exists: true } }),
    c.countDocuments({ 'whois.registered': { $gt: new Date(Date.now() - 2 * 365 * 86400000) } }),
    c.countDocuments({ 'whois.registered': { $lt: new Date(Date.now() - 10 * 365 * 86400000) } }),
  ]);

  const result = {
    total, handwerker, researchers,
    weakness: { weakSite, noEmail, noPhone, noSocials, noPhotos, noRating, weakAll },
    strength: { youtubeWithDate, websiteAndSocials, fullData },
    ageGroups,
    audit: { total: auditTotal, critical: auditCritical, major: auditMajor, minor: auditMinor, none: auditNone, lastWeek: auditedRecently },
    whois: { total: whoisTotal, young: whoisYoung, old: whoisOld },
  };
  metricsCache = { ts: Date.now(), data: result };
  res.json(result);
});

// ── Smart targets — preset фильтры для outreach ────────────────────────────
const TARGETS: Array<{ id: string; label: string; description: string; query: any; sort?: any }> = [
  {
    id: 'need-website',
    label: '🌐 Нужен сайт',
    description: 'Есть телефон/адрес, но нет website — кандидаты на услугу "сделать сайт"',
    query: {
      $or: [{ website: '' }, { website: { $exists: false } }],
      phone: { $exists: true, $ne: '' },
      city: { $exists: true, $ne: '' },
      externalSources: { $nin: ['openalex', 'orcid', 'github', 'gnd'] },
    },
  },
  {
    id: 'need-email',
    label: '✉ Нужен email',
    description: 'Есть website + phone но нет email — для outreach или регистрации в CRM',
    query: {
      website: { $exists: true, $ne: '' },
      phone: { $exists: true, $ne: '' },
      $or: [{ email: { $size: 0 } }, { email: { $exists: false } }],
    },
  },
  {
    id: 'need-socials',
    label: '📱 Нужны соцсети',
    description: 'Есть сайт и phone — но без Instagram/Facebook/YouTube. Услуга SMM',
    query: {
      website: { $exists: true, $ne: '' },
      phone: { $exists: true, $ne: '' },
      'socials.instagram': { $exists: false },
      'socials.facebook': { $exists: false },
      'socials.youtube': { $exists: false },
    },
  },
  {
    id: 'need-photos',
    label: '📷 Нужны фото / визуал',
    description: 'Есть бизнес (phone + website) но нет фото. Услуга фотосъёмка',
    query: {
      phone: { $exists: true, $ne: '' },
      website: { $exists: true, $ne: '' },
      $or: [{ photos: { $size: 0 } }, { photos: { $exists: false } }],
    },
  },
  {
    id: 'fresh-yt',
    label: '🆕 Свежие YT каналы (<2 года)',
    description: 'Канал создан недавно — обычно растущие бизнесы, ищут услуги',
    query: {
      youtubePublishedAt: { $gt: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) },
    },
    sort: { youtubePublishedAt: -1 },
  },
  {
    id: 'old-yt',
    label: '🏛 Старые YT каналы (>10 лет)',
    description: 'Долгоживущие — стабильные клиенты, deep pockets',
    query: {
      youtubePublishedAt: { $lt: new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000) },
    },
    sort: { youtubePublishedAt: 1 },
  },
  {
    id: 'has-radar-no-email',
    label: '🎯 Radar записи без email',
    description: 'HWK-зарегистрированный + есть hwkUrl — кандидаты на enrich-handwerker-radar-hwk',
    query: {
      'radarMeta.hwkUrl': { $exists: true, $ne: '' },
      $or: [{ email: { $size: 0 } }, { email: { $exists: false } }],
    },
  },
  {
    id: 'full-stack',
    label: '⭐ Полный набор (для CRM)',
    description: 'Phone + email + website + socials — готовы к outreach',
    query: {
      phone: { $exists: true, $ne: '' },
      'email.0': { $exists: true },
      website: { $exists: true, $ne: '' },
      'socials.instagram': { $exists: true, $ne: '' },
    },
  },
  {
    id: 'weak-all',
    label: '⚠ Совсем слабые (skip / archive)',
    description: 'Нет ни email, ни website, ни socials. Скорее закрыто/неактуально',
    query: {
      $and: [
        { $or: [{ website: '' }, { website: { $exists: false } }] },
        { $or: [{ email: { $size: 0 } }, { email: { $exists: false } }] },
        { 'socials.instagram': { $exists: false } },
        { 'socials.facebook': { $exists: false } },
      ],
    },
  },
  // ── "С X" slices для Stats drill-down ──
  { id: 'with-phone', label: '📞 С телефоном', description: 'Все записи с заполненным phone', query: { phone: { $exists: true, $ne: '' } } },
  { id: 'with-email', label: '✉ С email', description: 'Все записи с заполненным email', query: { 'email.0': { $exists: true } } },
  { id: 'with-website', label: '🌐 С сайтом', description: 'Все записи с website', query: { website: { $exists: true, $ne: '' } } },
  { id: 'with-socials', label: '📱 С соцсетями', description: 'Хотя бы одна соцсеть', query: {
    $or: [
      { 'socials.instagram': { $exists: true, $ne: '' } },
      { 'socials.facebook':  { $exists: true, $ne: '' } },
      { 'socials.youtube':   { $exists: true, $ne: '' } },
      { 'socials.tiktok':    { $exists: true, $ne: '' } },
    ],
  }},
  { id: 'with-radar-meta', label: '🎯 С radarMeta', description: 'Записи с handwerker-radar metadata', query: { radarMeta: { $exists: true } } },
  { id: 'with-hwk-url', label: '🏛 С HWK URL', description: 'Есть ссылка на HWK chamber page', query: { 'radarMeta.hwkUrl': { $exists: true, $ne: '' } } },
  { id: 'all', label: 'Все записи', description: 'Все 2M+ providers', query: {} },
  // ── Audit-driven targets (heuristic-based verdict) ──
  {
    id: 'audit-critical',
    label: '🚨 Audit: критические',
    description: 'Audit verdict = critical — слабый сайт + нет соцсетей. Топ-приоритет для услуг "сайт под ключ + SMM"',
    query: { 'audit.overallNeed': 'critical' },
    sort: { 'audit.websiteScore': 1 },
  },
  {
    id: 'audit-major',
    label: '🟠 Audit: major need',
    description: 'Audit verdict = major. Нужен серьёзный апгрейд (редизайн/SEO/контент)',
    query: { 'audit.overallNeed': 'major' },
  },
  {
    id: 'audit-website-rebuild',
    label: '🔨 Audit: rebuild website',
    description: 'Recommendation = redesign-website или rebuild — серьёзные клиенты для Site Factory',
    query: {
      'audit.recommendations': { $in: ['redesign-website', 'rebuild-website-current-broken'] },
    },
  },
  {
    id: 'audit-old-cms',
    label: '🏚 Старые CMS (Jimdo/IONOS)',
    description: 'Используют Jimdo / Wix / IONOS — типично выглядят устарело, готовая ниша для миграции',
    query: { 'audit.signals.web.cms': { $in: ['jimdo', 'wix', 'ionos'] } },
  },
  {
    id: 'audit-needs-blog',
    label: '📝 Нужен blog/контент',
    description: 'Сайт без blog — потенциал для "контент-завода" с SEO статьями',
    query: { 'audit.recommendations': 'add-blog' },
  },
];

// Cache 90 секунд — counts меняются медленно
let targetsCache: { ts: number; data: any } | null = null;
const TARGETS_TTL_MS = 90_000;

r.get('/smart-targets', async (_req, res) => {
  if (targetsCache && Date.now() - targetsCache.ts < TARGETS_TTL_MS) {
    return res.json(targetsCache.data);
  }
  const c = col();
  const out = await Promise.all(TARGETS.map(async t => ({
    id: t.id, label: t.label, description: t.description,
    count: await c.countDocuments(t.query),
  })));
  targetsCache = { ts: Date.now(), data: out };
  res.json(out);
});

r.get('/smart-targets/:id', async (req, res) => {
  const t = TARGETS.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'target not found' });
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const skip = parseInt(String(req.query.skip || '0'), 10);
  const projection = {
    name: 1, phone: 1, email: 1, website: 1, socials: 1,
    address: 1, city: 1, category: 1, externalSources: 1,
    youtubePublishedAt: 1, radarMeta: 1, rating: 1, photos: 1,
  };
  const sort = t.sort || { updatedAt: -1 };
  const [total, items] = await Promise.all([
    col().countDocuments(t.query),
    col().find(t.query, { projection }).sort(sort).skip(skip).limit(limit).toArray(),
  ]);
  res.json({ total, items, target: { id: t.id, label: t.label, description: t.description } });
});

// ── Список indexов для оптимизации запросов ─────────────────────────────────
r.get('/indexes', async (_req, res) => {
  const idx = await col().indexes();
  res.json(idx);
});

export default r;
