import { Router } from 'express';
import { SeoRun } from '../db.js';
import { generateSeeds, getSeedStats } from '../seo-pipeline/seedGenerator.js';
import { isConfigured as gAdsConfigured, getKeywordMetrics } from '../seo-pipeline/googleAdsClient.js';
import { isConfigured as dfsConfigured, getSerp, estimateDifficulty } from '../seo-pipeline/dataForSeoClient.js';
import { isConfigured as gscConfigured, getTopQueries } from '../seo-pipeline/gscClient.js';
import { rescoreAll, topOpportunities, topOpportunitiesMulti, getCoverage, generateContentBrief, computeScore } from '../seo-pipeline/opportunityScorer.js';
import { expandSeeds, estimateVolumeByAutocomplete } from '../seo-pipeline/autocompleteScraper.js';
import { DirectorTraining, KeywordSeed, Keyword } from '../db.js';
import { embedAndUpsert } from '../seo-pipeline/qdrantTraining.js';
import { extractCandidates } from '../seo-pipeline/candidateExtractor.js';
import { fetchHwkServicesRateLimited } from '../seo-pipeline/hwkScraper.js';
import { KeywordCluster } from '../db.js';
import mongoose from 'mongoose';
// Note: SeoRun импортирован выше, остальные модели здесь

const r = Router();

// ── Status / overview ──
r.get('/status', async (_req, res) => {
  const seedStats = await getSeedStats();
  const keywordCount = await Keyword.countDocuments({});
  const lastRun = await SeoRun.findOne().sort({ startedAt: -1 }).lean();
  res.json({
    seeds: seedStats,
    keywords: keywordCount,
    lastRun,
    sources: {
      googleAds: { configured: gAdsConfigured() },
      dataForSeo: { configured: dfsConfigured() },
      gsc: { configured: gscConfigured() },
    },
  });
});

// ── Coverage по category × city ──
r.get('/coverage', async (_req, res) => {
  res.json(await getCoverage());
});

// ── Top opportunities ──
r.get('/keywords', async (req, res) => {
  const category = req.query.category as string | undefined;
  const city = req.query.city as string | undefined;
  const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
  const items = await topOpportunities(category, city, limit);
  res.json({ items, total: items.length });
});

// ── Single keyword detail ──
r.get('/keyword/:id', async (req, res) => {
  const item = await Keyword.findById(req.params.id).lean();
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

// ── Content brief для BBITE Site Factory ──
r.get('/brief', async (req, res) => {
  const providerId = req.query.providerId as string;
  if (!providerId) return res.status(400).json({ error: 'providerId required' });
  const brief = await generateContentBrief(providerId);
  if (!brief) return res.status(404).json({ error: 'provider not found' });
  res.json(brief);
});

// ── Per-provider drill-down: brief + полный keyword cluster + training history ──
// Composit endpoint для UI — внутри переиспользует generateContentBrief() и
// topOpportunities(). Возвращает то что нужно для tab "SEO Full" в Database.
//
// Fallback enrichment: если global keywords для (cat, city) пустой → извлекаем
// candidateKeywords из existing полей провайдера (websiteText, youtubeAbout,
// audit signals) — без новых scrape запросов. UI показывает их с inline
// «годится/мусор» кнопками; «годится» создаёт keyword-feedback rating +2 →
// embed → Qdrant → следующие brief'ы для той же категории учтут.
r.get('/provider/:id/full', async (req, res) => {
  const providerId = req.params.id;
  const brief = await generateContentBrief(providerId);
  if (!brief) return res.status(404).json({ error: 'provider not found' });

  // Загружаем сам provider doc для extraction'а (generateContentBrief возвращает
  // только подмножество полей — не хватает websiteText, youtubeAbout, audit.signals).
  const providersCol = mongoose.connection.collection('providers');
  let _id: any = providerId;
  if (mongoose.Types.ObjectId.isValid(providerId)) _id = new mongoose.Types.ObjectId(providerId);
  const fullProvider = await providersCol.findOne(
    { $or: [{ _id }, { googlePlaceId: providerId }] },
    {
      projection: {
        category: 1, description: 1, websiteText: 1,
        siteAnalysis: 1, socialContent: 1,
        youtubeAbout: 1, youtubeVideos: 1, importedVideos: 1,
        'audit.signals': 1,
        'radarMeta.hwkUrl': 1,
        handwerkServices: 1,
      },
    },
  );

  // ── HWK Gewerke: lazy-fetch + cache ──
  // Если у провайдера есть hwkUrl и handwerkServices ещё не sсached (или старше года) —
  // fetch'аем live (~2-5s через rate limiter), сохраняем в provider doc.
  // Это критично для провайдеров без сайта — Gewerke = единственный достоверный
  // источник «вид услуг» для SEO.
  let handwerkServices = fullProvider?.handwerkServices;
  const hwkUrl = fullProvider?.radarMeta?.hwkUrl;
  const cacheTtlMs = 365 * 24 * 60 * 60 * 1000;
  const stale = !handwerkServices?.scannedAt
    || (Date.now() - new Date(handwerkServices.scannedAt).getTime() > cacheTtlMs);
  if (hwkUrl && (!handwerkServices || stale) && req.query.skipHwk !== '1') {
    try {
      const fetched = await fetchHwkServicesRateLimited(hwkUrl);
      handwerkServices = fetched;
      if (fullProvider?._id) {
        // только $set на новое поле — не модифицируем существующие данные провайдера
        await providersCol.updateOne(
          { _id: fullProvider._id },
          { $set: { handwerkServices: fetched } },
        );
      }
    } catch (e: any) {
      console.warn(`[seo/full] HWK fetch failed for ${providerId}: ${e.message}`);
    }
  }

  // Cluster использует тот же multi-term поиск что и brief — чтобы отображать
  // ВСЕ keywords для category + Gewerke провайдера (а не только category).
  const clusterTerms = new Set<string>();
  if (brief.category) clusterTerms.add(String(brief.category).toLowerCase());
  if (Array.isArray(handwerkServices?.items)) {
    for (const g of handwerkServices.items) {
      if (typeof g === 'string') clusterTerms.add(g.toLowerCase());
    }
  }
  // Подгружаем семантические кластеры — в response.clusters
  const cityRegex = brief.city ? new RegExp('^' + (brief.city as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : undefined;
  const termsArray = Array.from(clusterTerms);
  const escTerms = termsArray.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const catRegexes = escTerms.map(e => new RegExp('^' + e + '$', 'i'));
  const clustersFilter: any = { category: { $in: catRegexes } };
  if (cityRegex) clustersFilter.city = { $regex: cityRegex };

  const [keywordCluster, trainingRecords, semanticClusters] = await Promise.all([
    topOpportunitiesMulti(Array.from(clusterTerms), brief.city as string, 50),
    DirectorTraining.find({ providerId }).sort({ createdAt: -1 }).limit(20).lean(),
    KeywordCluster.find(clustersFilter).sort({ volumeTotal: -1 }).limit(20).lean(),
  ]);

  // Передаём handwerkServices в extractor — там это станет highest-weight source.
  const enrichedProvider = fullProvider ? { ...fullProvider, handwerkServices } : null;
  const candidateKeywords = enrichedProvider ? extractCandidates(enrichedProvider) : [];

  res.json({
    brief,
    handwerkServices: handwerkServices || null,
    keywordCluster: keywordCluster.map(k => ({
      _id: String(k._id),
      keyword: k.keyword,
      volume: k.avgMonthlySearches,
      difficulty: k.serpDifficulty,
      score: k.opportunityScore,
      sources: k.sources,
      gscPosition: k.gscOurPosition,
    })),
    candidateKeywords,
    // Semantic clusters — group similar keywords. UI рендерит их как карточки
    // с pageType badge + supporting chips. Centroid не возвращаем (768d, шум).
    clusters: semanticClusters.map(c => ({
      _id: String(c._id),
      category: c.category,
      city: c.city,
      clusterName: c.clusterName,
      headKeyword: c.headKeyword,
      supportingKeywords: c.supportingKeywords || [],
      volumeTotal: c.volumeTotal || 0,
      pageType: c.pageType || 'service-page',
      size: c.size || 1,
      generatedAt: c.generatedAt,
      llmReview: c.llmReview || null,
    })),
    trainingRecords: trainingRecords.map(t => ({
      _id: String(t._id),
      kind: t.kind,
      userComment: t.userComment,
      rating: t.rating,
      createdAt: t.createdAt,
    })),
    stats: {
      keywordCount: keywordCluster.length,
      candidateCount: candidateKeywords.length,
      clusterCount: semanticClusters.length,
      trainingCount: trainingRecords.length,
      hwkServicesCount: handwerkServices?.items?.length || 0,
      hasMainKeyword: !!brief.mainKeyword,
    },
  });
});

// ── List clusters by category/city OR by providerId ──
r.get('/clusters', async (req, res) => {
  const filter: any = {};
  if (req.query.providerId) {
    const providersCol = mongoose.connection.collection('providers');
    let _id: any = req.query.providerId;
    if (mongoose.Types.ObjectId.isValid(String(req.query.providerId))) _id = new mongoose.Types.ObjectId(String(req.query.providerId));
    const provider = await providersCol.findOne(
      { $or: [{ _id }, { googlePlaceId: req.query.providerId }] },
      { projection: { category: 1, city: 1, 'handwerkServices.items': 1 } },
    );
    if (!provider) return res.status(404).json({ error: 'provider not found' });
    const terms: string[] = [];
    if (provider.category) terms.push(String(provider.category).toLowerCase());
    if (Array.isArray(provider.handwerkServices?.items)) {
      for (const g of provider.handwerkServices.items) {
        if (typeof g === 'string') terms.push(g.toLowerCase());
      }
    }
    if (terms.length === 0) return res.json({ clusters: [] });
    const escTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    filter.category = { $in: escTerms.map(e => new RegExp('^' + e + '$', 'i')) };
    if (provider.city) filter.city = { $regex: new RegExp('^' + (provider.city as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
  } else {
    if (req.query.category) filter.category = String(req.query.category).toLowerCase();
    if (req.query.city) filter.city = { $regex: new RegExp('^' + String(req.query.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
  }
  if (req.query.pageType) filter.pageType = String(req.query.pageType);

  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const clusters = await KeywordCluster.find(filter).sort({ volumeTotal: -1 }).limit(limit).lean();
  res.json({
    clusters: clusters.map(c => ({
      _id: String(c._id),
      category: c.category,
      city: c.city,
      clusterName: c.clusterName,
      headKeyword: c.headKeyword,
      supportingKeywords: c.supportingKeywords,
      volumeTotal: c.volumeTotal,
      pageType: c.pageType,
      size: c.size,
      generatedAt: c.generatedAt,
      llmReview: c.llmReview || null,
    })),
    total: clusters.length,
  });
});

// ── Manually trigger LLM overseer для (category, city) пары ──
// Полезно: после recluster-existing.ts чтобы прогнать LLM на накопленных кластерах.
r.post('/clusters/llm-review', async (req, res) => {
  const { category, city } = req.body || {};
  if (!category || !city) return res.status(400).json({ error: 'category + city required' });
  const { reviewAndPersistClustersForPair } = await import('../seo-pipeline/llmOverseer.js');
  const stats = await reviewAndPersistClustersForPair(String(category).toLowerCase(), city);
  res.json({ ok: true, ...stats });
});

// ── Запуск pipeline'ов ──
r.post('/research/seed', async (req, res) => {
  const opts = req.body || {};
  try {
    const result = await generateSeeds(opts);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

r.post('/research/google-ads', async (req, res) => {
  if (!gAdsConfigured()) {
    return res.status(503).json({ error: 'Google Ads API not configured. Set GOOGLE_ADS_DEVELOPER_TOKEN, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, LOGIN_CUSTOMER_ID in .env.' });
  }
  const limit = Math.min(parseInt(String(req.body?.limit || '500')), 10000);
  const run = await SeoRun.create({ source: 'google-ads', scope: `limit=${limit}` });
  try {
    // Pull seeds которые ещё не обработаны (или не обновлены за последние 30 дней)
    const seeds = await KeywordSeed.find({ processed: false }).limit(limit).lean();
    const keywords = seeds.map(s => s.seed);
    const metrics = await getKeywordMetrics(keywords);

    let upserted = 0;
    for (const m of metrics) {
      const seed = seeds.find(s => s.seed.toLowerCase() === m.keyword.toLowerCase());
      const upd: any = {
        avgMonthlySearches: m.avgMonthlySearches,
        searchesByMonth: m.searchesByMonth,
        competitionIndex: m.competitionIndex,
        bidLow: m.bidLowMicros / 10000,
        bidHigh: m.bidHighMicros / 10000,
        category: seed?.category,
        city: seed?.city,
      };
      const opportunityScore = computeScore({
        volume: m.avgMonthlySearches,
        difficulty: 0,
        competition: m.competitionIndex,
        isGeoTargeted: !!seed?.city,
      });
      upd.opportunityScore = opportunityScore;

      await Keyword.updateOne(
        { keyword: m.keyword.toLowerCase() },
        {
          $set: { ...upd, fetchedAt: new Date() },
          $addToSet: { sources: 'google-ads' },
          $setOnInsert: { keyword: m.keyword.toLowerCase(), language: 'de', country: 'DE' },
        },
        { upsert: true },
      );
      upserted++;
    }
    await KeywordSeed.updateMany({ seed: { $in: keywords } }, { $set: { processed: true, processedAt: new Date() } });
    await SeoRun.updateOne({ _id: run._id }, { $set: { endedAt: new Date(), totalKeywords: keywords.length, enriched: upserted, status: 'completed' } });
    res.json({ ok: true, processed: keywords.length, upserted });
  } catch (e: any) {
    await SeoRun.updateOne({ _id: run._id }, { $set: { endedAt: new Date(), status: 'failed', errorMessage: e.message } });
    res.status(500).json({ error: e.message });
  }
});

// ── Autocomplete expansion (БЕСПЛАТНО, без API token) ──
// Расширяет seeds через Google/YouTube/Bing/Amazon DE autocomplete + рекурсивно по алфавиту.
// Каждый seed → ~50-200 long-tail вариантов.
r.post('/research/autocomplete', async (req, res) => {
  const limitSeeds = Math.min(parseInt(String(req.body?.limitSeeds || '50')), 500);
  const sources = req.body?.sources || ['google', 'bing'];
  const depth = Math.min(parseInt(String(req.body?.depth || '2')), 3);
  const useProxy = req.body?.useProxy === true;

  const seedDocs = await KeywordSeed.find({ processed: { $ne: true } }).limit(limitSeeds).lean();
  if (seedDocs.length === 0) {
    return res.json({ ok: true, processed: 0, expanded: 0, message: 'Нет необработанных seeds. Сначала сгенерируй seeds.' });
  }

  const seeds = seedDocs.map(s => s.seed);
  const run = await SeoRun.create({ source: 'seed-gen', scope: `autocomplete:${sources.join('+')}:depth=${depth}` });

  try {
    const expansions = await expandSeeds(seeds, { sources, depth, useProxy, delayMs: 250, maxPerSource: 200 });

    // Сохраняем в Keyword collection с флагом source
    const ops: any[] = [];
    for (const exp of expansions) {
      // Match category/city из parent seed
      const parentDoc = seedDocs.find(s => s.seed === exp.parentSeed);
      ops.push({
        updateOne: {
          filter: { keyword: exp.text },
          update: {
            $set: {
              language: 'de',
              country: 'DE',
              category: parentDoc?.category,
              city: parentDoc?.city,
              fetchedAt: new Date(),
            },
            $addToSet: { sources: 'serp-suggestion' },
            $setOnInsert: { keyword: exp.text },
          },
          upsert: true,
        },
      });
    }
    let added = 0;
    if (ops.length > 0) {
      const result = await Keyword.collection.bulkWrite(ops, { ordered: false });
      added = result.upsertedCount;
    }

    // Помечаем seeds обработанными
    await KeywordSeed.updateMany({ seed: { $in: seeds } }, { $set: { processed: true, processedAt: new Date() } });
    await SeoRun.updateOne({ _id: run._id }, { $set: { endedAt: new Date(), totalKeywords: expansions.length, newKeywords: added, status: 'completed' } });

    res.json({ ok: true, processed: seeds.length, expanded: expansions.length, added });
  } catch (e: any) {
    await SeoRun.updateOne({ _id: run._id }, { $set: { endedAt: new Date(), status: 'failed', errorMessage: e.message } });
    res.status(500).json({ error: e.message });
  }
});

// ── Volume estimation through autocomplete-rank (heuristic, без API) ──
r.post('/research/estimate-volume', async (req, res) => {
  const limit = Math.min(parseInt(String(req.body?.limit || '100')), 500);
  const candidates = await Keyword.find({
    avgMonthlySearches: { $in: [0, null] },
  }).limit(limit).lean();

  let processed = 0;
  for (const k of candidates) {
    const est = await estimateVolumeByAutocomplete(k.keyword, { sources: ['google'] });
    // Mapping popularityScore (0-100) → fake avgMonthlySearches range
    // 100 → 5000+, 50 → 500, 10 → 50
    const fakeVol = Math.round(Math.exp(est.popularityScore / 18) * 10);
    await Keyword.updateOne({ _id: k._id }, {
      $set: {
        avgMonthlySearches: fakeVol,
        // Дополнительный флаг что это эвристика, не точные данные
      },
      $addToSet: { sources: 'serp-suggestion' },
    });
    processed++;
    await new Promise(r => setTimeout(r, 200));
  }
  await rescoreAll();
  res.json({ ok: true, processed, note: 'Volume — эвристика по autocomplete-rank, точность ~60%. Замени реальными числами через Google Ads когда получишь token.' });
});

r.post('/research/serp', async (req, res) => {
  if (!dfsConfigured()) {
    return res.status(503).json({ error: 'DataForSEO not configured. Set DATAFORSEO_LOGIN/PASSWORD in .env.' });
  }
  const minVolume = parseInt(String(req.body?.minVolume || '50'));
  const limit = Math.min(parseInt(String(req.body?.limit || '100')), 1000);
  const run = await SeoRun.create({ source: 'dataforseo', scope: `minVol=${minVolume},limit=${limit}` });
  try {
    const candidates = await Keyword.find({
      avgMonthlySearches: { $gte: minVolume },
      $or: [{ serpDifficulty: { $exists: false } }, { serpDifficulty: 0 }],
    }).limit(limit).lean();

    let processed = 0;
    for (const k of candidates) {
      const serp = await getSerp(k.keyword, { city: k.city || undefined });
      if (serp) {
        const diff = estimateDifficulty(serp.top10);
        await Keyword.updateOne({ _id: k._id }, {
          $set: {
            serpTop10: serp.top10,
            serpFeatures: serp.features,
            serpDifficulty: diff,
          },
          $addToSet: { sources: 'dataforseo' },
        });
      }
      processed++;
      await new Promise(r => setTimeout(r, 100));
    }
    // Re-score после изменения difficulty
    await rescoreAll();
    await SeoRun.updateOne({ _id: run._id }, { $set: { endedAt: new Date(), totalKeywords: candidates.length, enriched: processed, status: 'completed' } });
    res.json({ ok: true, processed });
  } catch (e: any) {
    await SeoRun.updateOne({ _id: run._id }, { $set: { endedAt: new Date(), status: 'failed', errorMessage: e.message } });
    res.status(500).json({ error: e.message });
  }
});

r.post('/research/gsc', async (_req, res) => {
  if (!gscConfigured()) {
    return res.status(503).json({ error: 'GSC not configured. Set GOOGLE_SA_KEY_PATH + GSC_DEFAULT_SITE in .env.' });
  }
  try {
    const queries = await getTopQueries(28, 5000);
    let upserted = 0;
    for (const row of queries) {
      const keyword = (row.keys?.[0] || '').toLowerCase().trim();
      if (!keyword) continue;
      await Keyword.updateOne(
        { keyword },
        {
          $set: {
            gscOurImpressions: row.impressions,
            gscOurClicks: row.clicks,
            gscOurPosition: row.position,
            gscOurCtr: row.ctr,
            fetchedAt: new Date(),
          },
          $addToSet: { sources: 'gsc' },
          $setOnInsert: { keyword, language: 'de', country: 'DE' },
        },
        { upsert: true },
      );
      upserted++;
    }
    await rescoreAll();
    res.json({ ok: true, upserted });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

r.post('/rescore', async (_req, res) => {
  const result = await rescoreAll();
  res.json(result);
});

// ── Feedback от BBITE — после публикации сайта BBITE постит сюда GSC results ──
r.post('/feedback', async (req, res) => {
  const { keyword, position, impressions, clicks, ctr } = req.body || {};
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  await Keyword.updateOne({ keyword: String(keyword).toLowerCase() }, {
    $set: {
      gscOurPosition: position,
      gscOurImpressions: impressions,
      gscOurClicks: clicks,
      gscOurCtr: ctr,
      bbiteSyncedAt: new Date(),
    },
  });
  res.json({ ok: true });
});

// ── Director Training: пользовательские правки brief'ов и ключей ──
// Это feedback который потом загрузится в Qdrant как векторные знания для Director'а.
r.post('/training/feedback', async (req, res) => {
  const { kind, providerId, keywordId, category, city, originalData, editedData, userComment, rating } = req.body || {};
  if (!kind) return res.status(400).json({ error: 'kind required (brief-edit | keyword-feedback | verdict-correction | recommendation-priority | agent-output)' });
  // Лёгкая PII-санитизация userComment (email + phone) — для будущего DSGVO sweep'а полная
  const sanitized = (userComment || '')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d{2,4}[\s\-]?\(?\d{2,5}\)?[\s\-]?\d{2,5}[\s\-]?\d{0,5}/g, (m: string) => m.length >= 7 ? '[redacted-phone]' : m);
  const doc = await DirectorTraining.create({
    kind, providerId, keywordId, category, city,
    originalData, editedData,
    userComment: sanitized,
    rating,
  });
  // Async embed → Qdrant. Errors swallowed inside embedAndUpsert. Никогда не валит ответ.
  setImmediate(() => { embedAndUpsert(String(doc._id)).catch(() => {}); });
  res.json({ ok: true, id: String(doc._id) });
});

r.get('/training', async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
  const skip = parseInt(String(req.query.skip || '0'), 10);
  const filter: any = {};
  if (req.query.kind) filter.kind = req.query.kind;
  if (req.query.providerId) filter.providerId = req.query.providerId;
  const items = await DirectorTraining.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  const total = await DirectorTraining.countDocuments(filter);
  res.json({ items, total });
});

r.delete('/training/:id', async (req, res) => {
  await DirectorTraining.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ── Heatmap data: category × city × score ──
r.get('/heatmap', async (_req, res) => {
  const data = await Keyword.aggregate([
    { $match: { category: { $exists: true, $ne: '' }, city: { $exists: true, $ne: '' } } },
    {
      $group: {
        _id: { category: '$category', city: '$city' },
        keywords: { $sum: 1 },
        totalVolume: { $sum: '$avgMonthlySearches' },
        avgScore: { $avg: '$opportunityScore' },
        maxScore: { $max: '$opportunityScore' },
      },
    },
    { $sort: { maxScore: -1 } },
    { $limit: 1000 },
  ]);
  res.json({ cells: data });
});

export default r;
