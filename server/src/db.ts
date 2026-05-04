import mongoose, { Schema } from 'mongoose';
import { config } from './config.js';

export async function connectDb() {
  await mongoose.connect(config.mongoUri);
  console.log(`[db] connected: ${config.mongoUri}`);
}

// ── Schemas (минимальные, только наши коллекции) ──────────────────────────

const jobSchema = new Schema({
  scraperFile: { type: String, required: true }, // напр. "scrape-handwerker-radar.ts"
  args: { type: [String], default: [] },         // CLI аргументы
  cron: { type: String },                         // напр. "0 6 * * *" — null = on-demand
  enabled: { type: Boolean, default: true },
  label: { type: String },                        // дружественное имя ("Утренний радар-проход")
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
}, { collection: 'sc_jobs' });

const runSchema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'sc_jobs' },
  scraperFile: { type: String, required: true },
  args: { type: [String], default: [] },
  pid: { type: Number },
  startedAt: { type: Date, default: () => new Date() },
  endedAt: { type: Date },
  exitCode: { type: Number },
  exitReason: { type: String }, // 'completed' | 'killed' | 'crashed'
  logPath: { type: String },
  status: { type: String, default: 'running' }, // 'running' | 'completed' | 'failed' | 'killed'
}, { collection: 'sc_runs' });

const personaSchema = new Schema({
  name: { type: String, required: true },
  country: { type: String, default: 'de' },     // ISO-2: de, us...
  city: { type: String },                        // optional, для заметки
  proxySessionId: { type: String, required: true }, // зафиксирован → один и тот же IP
  proxyLifetime: { type: String, default: '24h' },  // максимум sticky lifetime
  profileDir: { type: String, required: true },     // постоянный Chrome profile dir
  notes: { type: String },                          // например "мой немецкий Google account"
  legitimacyConfirmed: { type: Boolean, default: false }, // юзер подтверждает что персона легитимна
  createdAt: { type: Date, default: () => new Date() },
  lastUsedAt: { type: Date },
}, { collection: 'sc_personas' });

// ── SEO Intelligence Pipeline ──
// keywords с volume + difficulty + opportunity score per (category × city)
const keywordSchema = new Schema({
  keyword: { type: String, required: true, index: true },
  language: { type: String, default: 'de' },
  country: { type: String, default: 'DE' },
  city: { type: String, index: true },
  category: { type: String, index: true },
  // Google Ads metrics
  avgMonthlySearches: { type: Number, default: 0 },
  searchesByMonth: [{ month: String, count: Number }],
  competitionIndex: { type: Number, default: 0 },
  bidLow: { type: Number, default: 0 },
  bidHigh: { type: Number, default: 0 },
  // SERP signals
  serpDifficulty: { type: Number, default: 0 },
  serpTop10: [{ position: Number, domain: String, url: String, title: String }],
  serpFeatures: [String],
  // GSC overlap (для своих сайтов)
  gscOurPosition: { type: Number },
  gscOurImpressions: { type: Number },
  gscOurClicks: { type: Number },
  gscOurCtr: { type: Number },
  // Opportunity score
  opportunityScore: { type: Number, default: 0, index: true },
  // Provenance
  sources: [{ type: String, enum: ['google-ads', 'dataforseo', 'gsc', 'seed', 'serp-suggestion', 'hwk-gewerk'] }],
  fetchedAt: { type: Date, default: () => new Date() },
  bbiteSyncedAt: { type: Date }, // когда отправили brief в BBITE
}, { collection: 'sc_keywords' });
keywordSchema.index({ category: 1, city: 1, opportunityScore: -1 });

const keywordSeedSchema = new Schema({
  seed: { type: String, required: true, unique: true },
  category: String,
  city: String,
  template: String, // "category-city", "category-city-modifier", "category-plz", ...
  modifier: String, // если applicable
  processed: { type: Boolean, default: false },
  processedAt: { type: Date },
  createdAt: { type: Date, default: () => new Date() },
}, { collection: 'sc_keyword_seeds' });

// Director training data — пользователь правит brief / отвечает на вопросы.
// Используется как feedback для Director'а: понять что хорошо, что плохо.
// Эти примеры можно загрузить в Qdrant как векторные знания.
const directorTrainingSchema = new Schema({
  kind: { type: String, enum: ['brief-edit', 'keyword-feedback', 'verdict-correction', 'recommendation-priority', 'agent-output'], required: true },
  providerId: { type: String, index: true },         // если связан с конкретным провайдером
  keywordId: { type: String },                        // если связан с конкретным keyword
  category: String, city: String,
  // Original (что предложил наш pipeline)
  originalData: Schema.Types.Mixed,
  // Edited (что пользователь поправил)
  editedData: Schema.Types.Mixed,
  // User comment ("слишком общий ключ", "этот сайт хорошо ранжируется", ...)
  userComment: String,
  rating: { type: Number, min: -2, max: 2 },          // -2=плохо .. 2=отлично
  // Vector embedding для добавления в Qdrant (заполняется позже)
  embeddingId: String,
  createdAt: { type: Date, default: () => new Date(), index: true },
}, { collection: 'sc_director_training' });
directorTrainingSchema.index({ kind: 1, createdAt: -1 });

// SEO bulk research jobs — per-selection orchestrated runs over many providers.
// Worker (seoJobWorker.ts, cron 15s tick) reserves pending → running, processes batch=25,
// idempotent: skips providers whose (category, city) Keyword set is fresh (<30 days).
// Survives restart via cursorIndex; zombie reaper at boot moves stuck running → pending.
const seoJobSchema = new Schema({
  label: String,
  selection: {
    kind: { type: String, enum: ['smart-target', 'manual'], required: true },
    targetId: String,                              // когда kind='smart-target'
    providerIds: [{ type: Schema.Types.ObjectId }], // когда kind='manual', cap 500
  },
  pipeline: { type: String, enum: ['brief-only', 'full-research'], default: 'brief-only' },
  status: {
    type: String,
    enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  },
  total: { type: Number, default: 0 },
  progress: {
    processed: { type: Number, default: 0 },
    succeeded: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
  },
  cursorIndex: { type: Number, default: 0 },     // offset в resolved selection — resume token
  rateLimit: {
    perMinute: { type: Number, default: 60 },
    useProxy: { type: Boolean, default: false },
  },
  startedAt: Date,
  endedAt: Date,
  errors: [{ providerId: String, message: String, at: Date }],  // capped at 100 в worker
  createdAt: { type: Date, default: () => new Date(), index: true },
  heartbeatAt: Date,                              // worker bumps каждый batch — для zombie reaper
}, { collection: 'sc_seo_jobs' });
seoJobSchema.index({ status: 1, createdAt: 1 });

// SEO research run history (для UI трекинга прогрессов)
const seoRunSchema = new Schema({
  source: { type: String, enum: ['google-ads', 'dataforseo', 'gsc', 'seed-gen'], required: true },
  scope: String,                     // "Friseur Berlin" / "all-DE" / "top-1000-by-volume"
  startedAt: { type: Date, default: () => new Date() },
  endedAt: Date,
  totalKeywords: Number,
  newKeywords: Number,
  enriched: Number,
  errorCount: Number,
  costUsd: Number,
  status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
  errorMessage: String,
}, { collection: 'sc_seo_runs' });

// Семантические кластеры — группа keywords с близким смыслом (по embedding'у).
// Каждый cluster ≈ одна страница на сайте провайдера или раздел.
// pageType классифицируется heuristic'ом по содержимому keywords.
const keywordClusterSchema = new Schema({
  category: { type: String, required: true, index: true }, // lowercase Gewerk OR provider.category
  city: { type: String, required: true, index: true },
  clusterName: { type: String, required: true },           // обычно = headKeyword
  headKeyword: {
    keyword: String,
    volume: Number,
    score: Number,
  },
  supportingKeywords: [{
    keyword: String,
    volume: Number,
    score: Number,
    similarity: Number,                                     // cosine с centroid
  }],
  volumeTotal: { type: Number, default: 0 },
  difficultyAvg: { type: Number, default: null },           // null когда DataForSEO не было
  pageType: {
    type: String,
    enum: ['service-page', 'pricing', 'faq', 'job-page', 'general'],
    default: 'service-page',
    index: true,
  },
  centroidVector: [Number],                                 // 768d Gemini embedding
  size: { type: Number, default: 1 },
  generatedAt: { type: Date, default: () => new Date(), index: true },
  // LLM overseer review (Haiku 4.5 quality-gate)
  llmReview: {
    qualityScore: { type: Number },                         // 0-10
    suggestedName: String,                                  // human-readable cluster label
    refinedPageType: {
      type: String,
      enum: ['service-page', 'pricing', 'faq', 'job-page', 'general', null],
    },
    flags: [String],                                        // 'incoherent', 'spam', 'mixed-intent'
    notes: String,                                          // 1-line LLM summary
    reviewedAt: Date,
  },
}, { collection: 'sc_keyword_clusters' });
keywordClusterSchema.index({ category: 1, city: 1, generatedAt: -1 });
keywordClusterSchema.index({ category: 1, city: 1, clusterName: 1 }, { unique: true });

export const Job = mongoose.model('Job', jobSchema);
export const Run = mongoose.model('Run', runSchema);
export const Persona = mongoose.model('Persona', personaSchema);
export const Keyword = mongoose.model('Keyword', keywordSchema);
export const KeywordSeed = mongoose.model('KeywordSeed', keywordSeedSchema);
export const SeoRun = mongoose.model('SeoRun', seoRunSchema);
export const SeoJob = mongoose.model('SeoJob', seoJobSchema);
export const KeywordCluster = mongoose.model('KeywordCluster', keywordClusterSchema);
export const DirectorTraining = mongoose.model('DirectorTraining', directorTrainingSchema);
