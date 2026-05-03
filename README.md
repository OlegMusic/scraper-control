# Scraper Control

Веб-интерфейс для управления всеми скраперами/энричерами parser-firecrawl + расписание + DB stats + LLM-ассистент для генерации новых скраперов.

## Структура

```
scraper-control/
├── server/   Express + Socket.io + Mongoose. Подключается к parser-firecrawl Mongo.
└── web/      React + Vite + Tailwind. Dashboard.
```

## Запуск (локально)

```bash
# Backend (порт 3100)
cd server
npm install
npm run dev

# Frontend (порт 5173) — отдельный терминал
cd web
npm install
npm run dev
```

Открыть http://localhost:5173

## Что делает

- **Dashboard**: статус всех скраперов parser-firecrawl, кнопки start/stop, live логи через WS
- **Schedule**: cron-расписание (каждое утро прогнать YT, HWK, radar и т.д.)
- **Stats**: DB-аналитика (total providers, по городам, gaps, coverage по полям)
- **Add resource** (Phase 2): URL → Claude API → draft скрапера → review → save в parser-firecrawl/src/
- **Terminal** (Phase 2): xterm.js + node-pty → реальный терминал в браузере с возможностью запустить `claude` CLI

## DB

Подключается к существующему `mongodb://localhost:27018/parser-firecrawl` (та же база что parser-firecrawl — никакие данные не дублируются). Создаёт две собственные коллекции:

- `sc_jobs` — конфигурация cron-задач
- `sc_runs` — история запусков (PID, started, exit code, exit reason, log path)

## Безопасность

Локальный bind на `127.0.0.1` — не публикуется наружу. Когда поднимем на твоём хостинге — добавим basic auth + HTTPS reverse proxy.
