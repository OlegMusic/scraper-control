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
