import { useEffect, useState } from 'react';
import { api } from '../api';

interface KeyStatus {
  envName: string;
  label: string;
  purpose: string;
  required: boolean;
  configured: boolean;
  preview: string;
}

interface KeysResponse {
  keys: KeyStatus[];
  parserEnvPath: string;
  parserEnvExists: boolean;
  scEnvPath: string;
  scEnvExists: boolean;
}

export function Settings() {
  const [data, setData] = useState<KeysResponse | null>(null);
  const [error, setError] = useState<string>('');

  async function refresh() {
    try {
      const r = await api.get<KeysResponse>('/settings/keys');
      setData(r.data);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => { refresh(); }, []);

  if (error) return <div className="text-red-400">Ошибка: {error}</div>;
  if (!data) return <div>Загрузка...</div>;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Источники .env (двойная загрузка)</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className={`rounded-lg border p-3 ${data.parserEnvExists ? 'border-emerald-600/40 bg-emerald-500/5' : 'border-amber-600/40 bg-amber-500/5'}`}>
            <div className="text-xs uppercase text-slate-400">Загружается ПЕРВЫМ — все API-ключи</div>
            <code className="font-mono text-sm break-all">{data.parserEnvPath}</code>
            <div className="mt-1 text-xs">
              {data.parserEnvExists
                ? <span className="text-emerald-400">✓ найден</span>
                : <span className="text-amber-400">⚠ не найден — проверь PARSER_FIRECRAWL_DIR</span>}
            </div>
          </div>
          <div className={`rounded-lg border p-3 ${data.scEnvExists ? 'border-blue-600/40 bg-blue-500/5' : 'border-slate-700 bg-slate-800/30'}`}>
            <div className="text-xs uppercase text-slate-400">Перекрывает PARSER (опционально)</div>
            <code className="font-mono text-sm break-all">{data.scEnvPath}</code>
            <div className="mt-1 text-xs">
              {data.scEnvExists
                ? <span className="text-blue-400">✓ найден</span>
                : <span className="text-slate-500">— не используется (это ОК)</span>}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">API-ключи</h3>
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 divide-y divide-slate-700/30">
          {data.keys.map(k => (
            <div key={k.envName} className="px-4 py-3 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full shrink-0" style={{
                background: k.configured ? '#10b981' : '#71717a',
              }}></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{k.label}</span>
                  <code className="text-xs text-slate-500">{k.envName}</code>
                </div>
                <div className="text-xs text-slate-400">{k.purpose}</div>
              </div>
              <div className="text-right shrink-0">
                {k.configured
                  ? <code className="text-xs text-emerald-400 font-mono">{k.preview}</code>
                  : <span className="text-xs text-slate-500">не задан</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4 text-sm">
        <h3 className="font-semibold mb-2">Как добавить/изменить ключ</h3>
        <ol className="list-decimal list-inside space-y-1 text-slate-300">
          <li>Открой файл <code className="font-mono text-blue-300">{data.parserEnvPath}</code></li>
          <li>Добавь или поменяй строку, например: <code className="font-mono text-emerald-300">YOUTUBE_API_KEY=AIzaSy...</code></li>
          <li>Сохрани файл</li>
          <li>Перезапусти scraper-control сервер (Ctrl+C → <code className="font-mono">npm run dev</code>)</li>
        </ol>
        <p className="mt-3 text-slate-400 text-xs">
          ⚠ Никогда не коммить .env в git. UI намеренно не позволяет редактировать ключи через браузер
          (HTTP-форма передавала бы секреты по сети — даже на localhost это рискованно).
        </p>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Real-time квоты</h3>
        <div className="space-y-2">
          <a href="https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas" target="_blank"
             className="block rounded-lg border border-slate-700 bg-slate-800/40 p-3 hover:bg-slate-800/60 transition">
            <div className="font-medium">YouTube Data API v3 — Quota dashboard</div>
            <div className="text-xs text-slate-400">Cloud Console · 10 000 units/day free</div>
          </a>
          <a href="https://console.cloud.google.com/apis/api/places-backend.googleapis.com/quotas" target="_blank"
             className="block rounded-lg border border-slate-700 bg-slate-800/40 p-3 hover:bg-slate-800/60 transition">
            <div className="font-medium">Google Places API — Quota dashboard</div>
            <div className="text-xs text-slate-400">Cloud Console · $200/мес бесплатный кредит</div>
          </a>
          <a href="https://console.anthropic.com/settings/usage" target="_blank"
             className="block rounded-lg border border-slate-700 bg-slate-800/40 p-3 hover:bg-slate-800/60 transition">
            <div className="font-medium">Anthropic — Usage</div>
            <div className="text-xs text-slate-400">Console · spend по моделям</div>
          </a>
        </div>
      </section>
    </div>
  );
}
