# Scraper Control — Project Instructions

Локальный admin dashboard для управления parser-firecrawl + AI Director + Audit + IPRoyal proxy + DB chat.
Это **отдельный проект**, который работает поверх существующей parser-firecrawl Mongo (~2M docs).

## Назначение

Платформа поддержки немецких Handwerker:
- **Site Factory** (FixIt AI) — автогенерация сайтов
- **Content Factory** (этот проект + далее) — управление парсерами, аудит клиентов, outreach пайплайны, контент для соцсетей

Цель Scraper Control — **видеть** базу 2M контактов и **действовать**: запускать парсинг, аудит, outreach campaigns, расписания.

## Стек

```
server/    Express + Socket.io + Mongoose + node-cron + Anthropic SDK
           tsx watch (auto-reload), порт 3100, bind 127.0.0.1
web/       Vite + React 18 + Tailwind 3, порт 5173
desktop/   Electron wrapper (то же UI в окне приложения)
```

## Структура

```
scraper-control/
├── CLAUDE.md                    ← этот файл
├── README.md                    общий гайд
├── iproyal-config.json          IPRoyal credentials (НЕ коммитить)
├── server/
│   ├── package.json
│   ├── .env                     SC_PORT, LOG_DIR, optionally ANTHROPIC_API_KEY
│   ├── .env.example
│   └── src/
│       ├── index.ts             Express + Socket.io entry
│       ├── config.ts            ENV loading (parser-firecrawl/.env первым, затем server/.env)
│       ├── db.ts                Mongoose schemas: Job, Run, Persona
│       ├── scraper-registry.ts  авто-discovery scrape-*.ts/enrich-*.ts в parser-firecrawl/src
│       ├── process-manager.ts   spawn/kill scraper processes, log → WebSocket
│       ├── scheduler.ts         node-cron jobs
│       ├── proxy.ts             IPRoyal URL builder + proxy-chain local proxy + browser launcher
│       ├── claude-bridge.ts     subprocess wrapper для Claude Code CLI (auth fallback)
│       ├── agents.ts            6 specialist agents для Director (radar/enrichment/youtube/data/cron/devops)
│       └── routes/
│           ├── scrapers.ts      GET list, POST run/stop, GET log/runs
│           ├── jobs.ts          CRUD cron jobs
│           ├── stats.ts         /overview /by-source /by-city /gaps
│           ├── settings.ts      API key status (без значений)
│           ├── director.ts      /agents /auth-status /chat (with tools)
│           ├── proxy.ts         /status /test /launch-browser /build-url-preview
│           ├── personas.ts      CRUD + /launch
│           ├── database.ts      /providers /metrics /smart-targets /smart-targets/:id
│           └── db-chat.ts       /chat для Mongo-aware DB Assistant
├── web/
│   ├── package.json
│   ├── vite.config.ts           proxy /api → 127.0.0.1:3100
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx             Router + Shell (header + nav)
│       ├── api.ts               axios + socket.io-client
│       ├── index.css            Глобальные стили + .pill / .glass-card / .hero-gradient
│       └── pages/
│           ├── Director.tsx     AI chat + agents panel + tool log
│           ├── Dashboard.tsx    список scraper'ов, start/stop, live логи
│           ├── Database.tsx     hero, smart-targets, table, DB chat (floating button)
│           ├── Schedule.tsx     cron jobs CRUD
│           ├── Stats.tsx        coverage по полям/городам
│           ├── ProxyPage.tsx    IPRoyal + Persona manager
│           └── Settings.tsx     API key status
└── desktop/
    ├── package.json             Electron deps
    ├── main.js                  BrowserWindow + load http://localhost:5173
    └── preload.js
```

## Запуск (dev)

```bash
# Terminal 1 — backend (порт 3100)
cd scraper-control/server
npm install
cp .env.example .env       # один раз
npm run dev                # tsx watch — auto-reload при изменении src/

# Terminal 2 — frontend (порт 5173)
cd scraper-control/web
npm install
npm run dev

# Terminal 3 — desktop (опционально, отдельное окно)
cd scraper-control/desktop
npm install
npm run dev
```

Открыть **http://localhost:5173**.

## Подключение к данным

Server подключается к **существующей** Mongo `mongodb://localhost:27018/parser-firecrawl` (та же что parser-firecrawl). НЕ дублирует providers.

Создаёт **собственные коллекции**:
- `sc_jobs` — cron-задачи (scraperFile, args, cron, label, enabled)
- `sc_runs` — история запусков (jobId, pid, startedAt, endedAt, exitCode, logPath, status)
- `sc_personas` — persona-профили для proxy + browser (proxySessionId, profileDir, country, lifetime, legitimacyConfirmed)

## ENV / API keys

Server загружает .env в порядке:
1. `parser-firecrawl/.env` — все API ключи (GOOGLE_PLACES_API_KEY, YOUTUBE_API_KEY, GEMINI_API_KEY, FIRECRAWL_API_KEY, TIKTOK_*)
2. `scraper-control/server/.env` — может перекрыть, обычно только для SC_PORT, ANTHROPIC_API_KEY

**Никогда не дублируй ключи в server/.env** если они уже в parser-firecrawl/.env. Это путь к stale-credential bugs.

## AI Director — режимы авторизации

**Дефолтный путь — Claude Code CLI (online auth)**, не API key. Это значит:
- Юзер уже авторизован в Claude Code через `claude login` (subscription Pro/Max/Team)
- Backend `claude-bridge.ts` использует эту авторизацию через subprocess `claude -p`
- Никаких API ключей не нужно, бесплатно в рамках подписки

| Mode | Условие | Возможности |
|---|---|---|
| `api-key` | `ANTHROPIC_API_KEY` в env | Полный режим: Claude Sonnet 4.6 + 11 tools (включая consult_agent), может **сам выполнять** действия. Платится по токенам. |
| `claude-cli` | Claude Code CLI установлен и авторизован | **Дефолтный режим**: bridge через `claude -p` subprocess. Текстовые советы, без custom tools. **Бесплатно** в рамках подписки. |
| `none` | Нет ни API key, ни Claude CLI | Director показывает банер с инструкциями |

Backend сам определяет mode при `/api/director/auth-status`. UI показывает badge "API key · полный режим" / "Claude CLI · text-режим".

**UTF-8 fix для Claude CLI:** subprocess pipe на Windows ломает кириллицу. В `claude-bridge.ts` промпт пишется в temp UTF-8 файл, передаётся через `cmd /c chcp 65001 && claude -p < tmpfile`.

**DB Chat (`/api/db-chat/chat`)** работает в обоих режимах:
- `api-key`: Claude вызывает Mongo tools (count/find/aggregate/distinct) сам
- `claude-cli`: даёт готовые Mongo-запросы текстом, юзер копирует в interface

## IPRoyal Proxy

См. также `~/.claude/projects/C--Users-prusi/memory/reference_iproyal_proxy.md`.

**Конфиг:** `scraper-control/iproyal-config.json` (НЕ коммитить, в .gitignore).
Структура: `{ username, password, defaultCountry, stickyByDefault, stickyLifetime, gatewayHost, gatewayPort, ... }`.

**Важно:** `password` — это БАЗОВАЯ часть (до `_country-`). Модификаторы `_country-XX_session-X_lifetime-Y` добавляются динамически в `proxy.ts` → `buildProxyUrl()`.

**Chrome auth fix:** Используется `proxy-chain` — backend поднимает локальный прокси на 127.0.0.1:RANDOM_PORT, который сам auth-ит upstream. Chrome подключается к локальному без диалога Basic Auth.

**Persona system:** для long-term identity (Google account login сохраняется через множественные сессии). Persona = фиксированный sessionId + постоянный profileDir.

## Конвенции кода

### Backend (server)

- **TypeScript strict, ESM modules** (NodeNext)
- **Mongoose** — schemas в `db.ts`. Никаких глобальных models в routes (importing из db.ts)
- **Socket.io** — broadcast `log`, `run:start`, `run:end` events
- **Process spawn** — через `child_process.spawn`, никогда не `exec` (security + buffer)
- **Логи** — каждый run пишет в `logs/<scraper>-<ts>.log`, ротация раз в неделю TODO
- **Мутации Mongo** — ТОЛЬКО `$set`, `$addToSet`, `$inc`. Никогда `$unset`, `deleteMany`, `drop`. См. `feedback_never_delete_parser_data.md`.

### Frontend (web)

- **Tailwind utility-first** + `.pill` / `.glass-card` / `.hero-gradient` reusables в `index.css`
- **Cards: rounded-2xl, border border-white/10, bg-slate-900/40 backdrop-blur**
- **Active pill: gradient from-blue-500 to-indigo-500**
- **Empty state: text-slate-400/500 + suggested-actions**
- **Modals: fixed inset-0 bg-black/70 backdrop-blur, click outside to close**
- **Внешние ссылки**: `<a href="..." target="_blank" onClick={e => e.stopPropagation()}>` чтобы не триггерить parent row click

### Имена

- Backend roots: `routes/<area>.ts` (множественное имя)
- Components React: `PascalCase`, файл = имя компонента
- Mongo fields: camelCase (`audit.websiteScore`, `radarMeta.hwkUrl`)

## Безопасные / опасные операции

### ✅ Безопасно (можно без подтверждения)

- `npm install` в server/ web/ desktop/
- Запуск scraper'ов через UI (managed by process-manager)
- Создание/удаление cron jobs
- Создание/launch persona

### ⚠ С подтверждением

- Удаление persona (`profileDir` остаётся на диске — ручное удаление если нужно)
- Удаление файлов в `chrome-profiles/` (могут содержать сохранённые Google logins)
- Перезапись `iproyal-config.json`
- Mass-kill node-процессов (могут быть active scraper'ы)

### ❌ Запрещено без явной просьбы

- `deleteMany` / `$unset` / `drop` в коллекции `providers` (см. `feedback_never_delete_parser_data.md`)
- Push API keys в логи / commits
- Запуск `while true` loops без user approval (создаёт нагрузку на shared infra)

## Common tasks

### Добавить новый smart-target

`server/src/routes/database.ts` → массив `TARGETS`:
```ts
{
  id: 'my-target',
  label: '🎯 Мой target',
  description: 'Описание для UI',
  query: { ... Mongo query ... },
  sort: { ... optional ... },
}
```
UI автоматически подхватит через `GET /api/database/smart-targets`.

### Добавить нового специалиста-агента для Director

`server/src/agents.ts` → push в `AGENTS`:
```ts
{
  id: 'my-agent',
  name: 'My Specialist',
  emoji: '🎯',
  description: 'Когда использовать',
  expertise: 'предметная область',
  systemPrompt: 'system prompt с экспертизой',
}
```
Director увидит автоматически через `consult_agent` tool.

### Добавить новый Director tool

`server/src/routes/director.ts` → 
1. Push в массив `TOOLS` (Anthropic.Tool definition)
2. Add case в `executeTool(name, input)` switch
3. Update `SYSTEM_PROMPT` чтобы LLM знал когда использовать

### Добавить новую страницу UI

1. Создать `web/src/pages/MyPage.tsx`
2. Импортировать в `web/src/main.tsx` и добавить в `<Routes>` + nav
3. API endpoints — отдельный `routes/my-page.ts` в server, mount в `index.ts`

## Performance / кэш

Из-за **2M+ записей в Mongo**, тяжёлые aggregation/count endpoints закэшированы в памяти:

| Endpoint | TTL | Note |
|---|---|---|
| `GET /api/database/metrics` | 60 сек | 16 countDocuments queries — первый раз ~12s, потом 50ms |
| `GET /api/database/smart-targets` | 90 сек | 16+ targets × countDocuments |
| `GET /api/stats/*` | без кэша | если станет медленно — добавь |

Если данные изменились и кэш мешает — рестарт сервера или ждём TTL.

## Слой Frontend → Backend для drill-down

Stats и Database страницы используют **smart-targets pattern** (НЕ raw Mongo queries через JSON):
1. Backend хранит preset queries в `routes/database.ts` → массив `TARGETS`
2. Frontend знает только `targetId` (e.g. `with-phone`, `audit-critical`, `need-website`)
3. Запрос: `GET /api/database/smart-targets/:id?limit=50&skip=0`
4. Безопасно (нет инъекций), легко кэшируется, реиспользуется в Director / DB Chat

**Не пиши raw $where/$function в smart-targets** — есть санитизация в endpoint, но всё равно risky.

## Глобальный чат

`web/src/components/GlobalChat.tsx` — floating button внизу справа на любой странице.
Имеет 2 режима:
- **💬 DB** → `/api/db-chat/chat` — спрашивает базу через Mongo tools (count/find/aggregate/distinct)
- **🤖 Director** → `/api/director/chat` — управление + 6 sub-agents

Оба работают в **API-key mode** (с `ANTHROPIC_API_KEY`) или **Claude CLI bridge** mode (через subprocess). Tools работают только в API-key mode.

## Поля провайдеров отображаемые в UI

В `pages/Database.tsx` provider table + modal детали показывают:
- `name`, `phone`, `email[]`, `website`, `address`, `city`, `category`
- `socials.{instagram,facebook,youtube,tiktok,telegram}` — кликабельные внешние ссылки
- `audit.{websiteScore, socialScore, overallNeed, recommendations, signals.web.cms}` — verdict бейдж + рекомендации
- `whois.{registered, registrar}` — дата регистрации домена
- `youtubePublishedAt` — год создания YT канала
- `youtubeSubscribers, youtubeVideoCount, youtubeViewCount` — YT статистика
- `youtubeAbout.{country, joinedYear, subscriberCount}` — данные с /about страницы
- `radarMeta.{hwkUrl, distanceKm, plz, contactPerson}` — handwerker-radar metadata

## SEO Intelligence Pipeline (Phase 0 + A)

**Цель:** keyword research для (category × city) которых ещё нет в BBITE Site Factory. scraper-control = research lab, BBITE = production.

### Архитектура источников

```
БЕСПЛАТНО (без API token):
  ✓ Google Autocomplete  (suggestqueries.google.com)
  ✓ Bing Autocomplete    (api.bing.com/osjson.aspx)
  ✓ YouTube Autocomplete (suggestqueries-clients6.youtube.com)
  ✓ Amazon DE            (completion.amazon.de)
  ✓ Heuristic volume через autocomplete-rank (грязный proxy для real volume)

ПЛАТНО / API token:
  ⏸ Google Ads API   (developer token нужен — заявка 1-7 дней через MCC)
  ⏸ DataForSEO       ($5-50/мес, SERP analysis)
  ⏸ GSC API          (бесплатно, только для своих доменов через Service Account)
```

### Файлы

```
server/src/
├── seo-pipeline/
│   ├── seedGenerator.ts        генерит seeds из providers (~10-15K)
│   ├── googleAdsClient.ts      stub-fallback если token нет
│   ├── dataForSeoClient.ts     SERP analysis
│   ├── gscClient.ts            Service Account JWT (parity с BBITE)
│   ├── opportunityScorer.ts    formula + Content Brief generator
│   └── autocompleteScraper.ts  Google/Bing/YT/Amazon + heuristic volume
└── routes/seo.ts               endpoints (/status, /coverage, /keywords, /brief, /research/*, /training/*)

web/src/pages/
├── SEO.tsx                     heatmap + keyword table + 6 pipeline buttons
└── Database.tsx                provider modal SEO Brief + Director training feedback
```

### Mongo collections (новые)

- `sc_keywords` — keyword × volume × difficulty × score × geo×category
- `sc_keyword_seeds` — seeds для исследования (~1.6M генерируется)
- `sc_seo_runs` — история pipeline runs
- `sc_director_training` — пользовательские правки brief'ов → обучение Director'а через Qdrant

### Endpoints

```
GET  /api/seo/status            current state + source configuration
GET  /api/seo/coverage          сколько category × city проанализировано
GET  /api/seo/keywords          top opportunities (?category=X&city=Y)
GET  /api/seo/keyword/:id       single keyword detail
GET  /api/seo/brief?providerId  Content Brief для BBITE Site Factory
GET  /api/seo/heatmap           category × city × score grid
POST /api/seo/research/seed                генерация seeds
POST /api/seo/research/autocomplete        🆓 расширение через autocomplete
POST /api/seo/research/estimate-volume     🆓 heuristic volume
POST /api/seo/research/google-ads          💰 точный volume (нужен token)
POST /api/seo/research/serp                💰 SERP via DataForSEO
POST /api/seo/research/gsc                 GSC sync (свои сайты)
POST /api/seo/rescore                       пересчёт opportunity scores
POST /api/seo/feedback                      BBITE присылает GSC delta
POST /api/seo/training/feedback             user правки brief'ов
GET  /api/seo/training                      list user feedback
```

### Workflow для production

```
1. POST /api/seo/research/seed        → 1.6M seeds в sc_keyword_seeds
2. POST /api/seo/research/autocomplete → extend через Google+Bing → keywords
3. POST /api/seo/research/estimate-volume → heuristic volume
4. (опц) POST /api/seo/research/serp  → DataForSEO для top-keys
5. (опц) POST /api/seo/research/gsc   → свои данные позиций
6. BBITE pulls GET /api/seo/brief?providerId=X при генерации /experte/{slug}
7. BBITE присылает POST /api/seo/feedback с GSC delta после публикации
8. Director видит "что работает" через /api/director/chat tools
```

### E-E-A-T compliance (важно из BBITE rules)

- Briefs дают только контентный план — не финальный текст
- BBITE применяет AI-generation с human review (expert correction loop)
- Local signals (PLZ + HWK chamber) обязательны в каждом brief — не doorway
- Никаких self-serving reviews в Schema.org

## SEO Bulk + Drill-down + RAG-обучение (Slice 1, 2026-05-03)

Расширение Phase 0/A: pick selection из /database → bulk SEO research job → click any
provider → видишь весь SEO срез → Director SEO-агенты учатся на feedback'е через RAG.

### Selection layer (/database)

- Чекбокс на каждой строке + «выбрать все на странице» (cap 500 manual).
- Sticky toolbar внизу: «Выбрано: N → 🎯 Run SEO research».
- Кнопка «🎯 Run SEO research на всю выборку» когда активен smart-target (для 100K).
- Confirm modal вызывает `POST /api/database/selection/resolve` для count + sample, потом `POST /api/seo-jobs`.

### Bulk job worker

`server/src/seo-pipeline/seoJobWorker.ts` + `routes/seo-jobs.ts`:
- Mongo `sc_seo_jobs` collection — каждое описание выборки + статус + `cursorIndex`.
- Cron tick `*/15 * * * * *` (Europe/Berlin) — атомарно резервирует pending → running.
- Batch=25 провайдеров за тик; на каждом вызывает `generateContentBrief(providerId)`. Для `pipeline:'full-research'` сначала делается dedupe (category, city) → autocomplete для пар без свежих keywords (<30 дней).
- Rate limit: token bucket 60/min (`rateLimiter.ts`). Job >1000 → автоматически `useProxy: true` (IPRoyal residential через `proxy.ts`).
- Restart-safe: zombie reaper в boot hook возвращает `running` без heartbeat>5min обратно в `pending`.
- Socket.io: `seo:job:start`, `seo:job:progress`, `seo:job:end` — `BulkSeoJobsPanel` слушает.

Endpoints:
```
POST /api/seo-jobs                 {selection:{kind,targetId?|providerIds?}, pipeline}
GET  /api/seo-jobs                 ?status=running
GET  /api/seo-jobs/:id
POST /api/seo-jobs/:id/{pause,resume,cancel}
```

### Per-provider drill-down

`GET /api/seo/provider/:id/full` — composit: brief + keywordCluster (top-50) + trainingRecords.
В Database modal — показывается ниже SEO Brief: cluster table + training history.

### RAG-обучение SEO-агентов

```
POST /api/seo/training/feedback
   ↓ (PII sanitize: email/phone → [redacted])
   ↓ Mongo insert (DirectorTraining)
   ↓ setImmediate
Gemini gemini-embedding-001 (768d, Matryoshka truncated, normalized)
   ↓
Qdrant collection director_training_seo_v1
   ↓ (при consult_agent)
retrieveSimilar(question, topK=4, ratingGte=1)
   ↓ (только для seo-strategist | serp-analyst | local-signals-expert)
augmentedSystemPrompt += "## Verified human feedback patterns:\n..."
```

Fallback: Qdrant down или Gemini quota out → `[]` → base systemPrompt. Никогда не валит ответ агента.
Nightly cron `0 3 * * *` пере-embed-ит записи у которых `embeddingId: null` (synchronous embed упал).

### 3 новых SEO-агента в `agents.ts`

- `seo-strategist` 🎯 — main + supporting cluster, E-E-A-T, BBITE Site Factory
- `serp-analyst` 🔍 — competitor SERP, content gaps, difficulty
- `local-signals-expert` 📍 — PLZ/HWK/Local Pack/Schema.org

Каждый получает RAG-augmented systemPrompt при invocation.

### DRY компонент

`web/src/components/TrainingFeedbackPanel.tsx` — единый компонент для feedback во всех местах (Database modal, SEO keyword detail). Поддерживает kinds: `brief-edit | keyword-feedback | verdict-correction | recommendation-priority | agent-output`.

### Verification

```bash
# Selection resolver
curl -X POST http://127.0.0.1:3100/api/database/selection/resolve \
  -d '{"kind":"smart-target","targetId":"audit-critical"}'  # → {count, sample}

# Create job
curl -X POST http://127.0.0.1:3100/api/seo-jobs \
  -d '{"selection":{"kind":"smart-target","targetId":"audit-critical"},"pipeline":"brief-only"}'
# → {jobId, total, useProxy:true}  (>1000 → IPRoyal)

# Drill-down
curl http://127.0.0.1:3100/api/seo/provider/<id>/full
# → {brief, keywordCluster, trainingRecords, stats}

# Embed pipeline
curl -X POST http://127.0.0.1:3100/api/seo/training/feedback \
  -d '{"kind":"keyword-feedback","category":"Friseur","city":"Berlin","userComment":"...","rating":2}'
# → {ok, id} → wait 3s → check points_count via Qdrant
curl http://127.0.0.1:6333/collections/director_training_seo_v1
```

### Iteration 2 (deferred)

- `/agents` control panel (per-agent stats: invocations, accept-ratio, recent feedback)
- Promote-to-prompt с версионированием agent.basePrompt (data-driven `sc_agents` collection)
- Cluster-and-propose систем-промпт diff (нужен ≥500 records на агента)
- Score history + GSC trend charts в drill-down
- Scoped `<SeoChat>` на /seo (сейчас всё через GlobalChat → Director)
- Materialized `sc_provider_selections` для долгих job'ов (>часа)

## SEO Slice 2: Junk Filter + Volume Heuristic + Semantic Clustering + LLM Overseer (2026-05-03)

После Slice 1 (orchestration) сделан Slice 2 — **качество семантики**. Pipeline в `seoJobWorker.ensureAutocompleteCoverage` теперь:

```
expandSeeds (Google+Bing)              → ~30 raw kw per (term, city)
  ↓
junkFilter.filterJunk()                → rules + LLM borderline cleanup
  ↓ ~70-95% kept
estimateVolumeByAutocomplete()         → fake avgMonthlySearches (±60% точность)
  ↓
computeScore()                         → opportunityScore (volume × dif × city × comp)
  ↓
bulkWrite в sc_keywords
  ↓
clusterKeywords()                      → Gemini embeddings + agglomerative
  ↓ N clusters per pair
classifyCluster()                      → service-page/pricing/faq/job-page/general
  ↓
reviewAndPersistClustersForPair()      → Haiku (или Claude CLI bridge fallback)
                                          → qualityScore + suggestedName +
                                          → refinedPageType + flags + notes
  ↓
sc_keyword_clusters (с llmReview)
```

### Новые модули (`server/src/seo-pipeline/`)

| Module | Назначение |
|---|---|
| `junkFilter.ts` | Rule blacklist (CAR_BRANDS, NON_HANDWERKER_BRANDS, AUTOMOTIVE_MASS, GENERIC_NOISE, JOB_PATTERNS) + Haiku batch для borderline. Detect automotive provider context — для Autolackiererei/KFZ-провайдеров CAR_BRANDS не filter'им (могут конкурировать). |
| `keywordClusterer.ts` | Gemini text-embedding-001 (768d, normalized) → threshold-based agglomerative (cosine ≥ 0.75, env var SEO_CLUSTER_THRESHOLD). Single-pass O(N×K). Fallback на 1 cluster при quota out. |
| `pageTypeClassifier.ts` | Heuristic regex для majority voting: pricing (preis/kosten/tarif), faq (was/wie/wo/?), job-page (jobs/ausbildung/gehalt). Default = service-page. |
| `llmOverseer.ts` | Haiku 4.5 batch (5 clusters/call) → JSON {qualityScore 0-10, suggestedName, refinedPageType, flags, notes}. Fallback: Claude CLI subprocess через `claudePrompt()` если нет ANTHROPIC_API_KEY. Идемпотентен (skip уже-просмотренных по `llmReview.reviewedAt`). |
| `serpScraper.ts` | UULE encoding для geo-targeting + parser regex + difficulty heuristic. **Не активен** — Google.de требует JS, pure-HTTP scrape блокирован. Reuse в Slice 3 через puppeteer-fleet. |

### Mongo collection `sc_keyword_clusters`

```ts
{
  category, city, clusterName,
  headKeyword: { keyword, volume, score },
  supportingKeywords: [{ keyword, volume, score, similarity }],
  volumeTotal, difficultyAvg,
  pageType, centroidVector: [768d], size,
  generatedAt,
  llmReview: {                              // ← AI quality-gate
    qualityScore: 0-10,
    suggestedName,                          // human-readable, e.g. "Maler-Preise Kassel"
    refinedPageType,                        // LLM может пере-классифицировать
    flags: ['mixed-intent', 'spam', ...],
    notes,                                  // 1-line German explanation
    reviewedAt,
  },
}
```

Compound indexes: `{category:1, city:1, generatedAt:-1}`, unique `{category:1, city:1, clusterName:1}`.

### Новые endpoints

```
GET  /api/seo/clusters?providerId=...|category=...&city=...&pageType=  → {clusters[], total}
POST /api/seo/clusters/llm-review  {category, city}                     → {ok, reviewed, batches}
```

`/api/seo/provider/:id/full` теперь содержит `clusters[]` с `llmReview` для каждого.

### Backfill script: `scripts/recluster-existing.ts`

Прогоняет накопленные `sc_keywords` через cluster pipeline без повторного autocomplete:

```bash
# Все pairs
npx tsx scripts/recluster-existing.ts --min-keywords 5

# Конкретная пара
npx tsx scripts/recluster-existing.ts --category 'maler und lackierer' --city Kassel

# С очисткой junk (deletes rejected keywords + clusters from sc_keyword_clusters)
npx tsx scripts/recluster-existing.ts --clean-junk

# С полным циклом (filter + recluster + LLM review)
npx tsx scripts/recluster-existing.ts --clean-junk --llm-review
```

### Verification (real test, 2026-05-03)

Test провайдер `Autolackiererei Kristall GmbH (Kassel)`:
- HWK Gewerke: ✓ `Maler und Lackierer` + `Karosserie- und Fahrzeugbauer`
- Cluster для Maler×Kassel:
  - clusterName (raw) = «maler und lackierer ausbildung kassel» (head по volume×score)
  - llmReview.suggestedName = «Maler und Lackierer Kassel - Allgemein»
  - llmReview.qualityScore = 4/10 (mixed-intent flag)
  - llmReview.refinedPageType = `general` (LLM сменил с `service-page`)
  - llmReview.notes = «Cluster vermischt lokale Suche in Kassel mit Ausbildung, Jobs, Innung und mehreren fremden Städten (Düsseldorf, Karlsruhe, Münster, München).»

UI рендерит:
- Желтую border (flag `mixed-intent`)
- Badge `🤖 4/10` (низкое качество)
- Заголовок `suggestedName` вместо raw clusterName
- Note внизу с объяснением

### LLM availability

| API key set | Claude CLI | Поведение llmOverseer |
|---|---|---|
| ✓ | — | Anthropic SDK, Haiku 4.5 batch |
| — | ✓ | Claude CLI subprocess fallback (медленнее, но free через subscription) |
| — | — | No-op, кластеры остаются без `llmReview` |

junkFilter LLM borderline review также fallback'ится. Pipeline никогда не валит ответ.

## Roadmap / TODO

- [ ] **Phase B: Management levers** — кнопки "запустить audit для smart-target X" из UI Database
- [ ] **Phase C: LLM-deep audit** — Claude API анализ HTML для top-1000 hot leads
- [ ] **Phase D: Socials audit через прокси** — IPRoyal-routed scrape для IG/FB/TT профилей
- [ ] **Phase E: Trainable model** — fine-tune Llama-3.1 на собранных audit verdicts
- [ ] **Phase F: Cron orchestration** — Director создаёт ежедневные расписания audit + outreach
- [ ] **Production deploy** — на user's хостинг, basic auth + HTTPS reverse proxy
- [ ] **Embedded terminal** — xterm.js + node-pty для запуска Claude CLI прямо в UI
- [ ] **FixIt AI integration** — кнопка "send to Site Factory" → push провайдера в FixIt

## Связанные проекты

- **parser-firecrawl** — источник скраперов и Mongo. Scraper Control его НЕ модифицирует, только запускает.
- **FixIt AI / BBITE** — public-facing platform для Handwerker. Scraper Control = admin tool, отдельно.
- **OpenClaw Vault** — Mongo + Redis + другая инфра. Scraper Control использует Mongo через connection string.
