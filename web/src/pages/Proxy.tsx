import { useEffect, useState } from 'react';
import { api } from '../api';

interface Country { code: string; name: string; }
interface ProxyStatus {
  configFile: string;
  fileExists: boolean;
  config: any | null;
  countries: Country[];
}
interface TestResult { ok: boolean; ip?: string; country?: string; latencyMs?: number; error?: string; }
interface LaunchResult { ok: boolean; pid?: number; proxyHost?: string; proxyPort?: number; country?: string; profileDir?: string; error?: string; }
interface Persona { _id: string; name: string; country: string; city?: string; notes?: string; proxySessionId: string; proxyLifetime: string; profileDir: string; lastUsedAt?: string; createdAt: string; }

export function ProxyPage() {
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [country, setCountry] = useState('de');
  const [sticky, setSticky] = useState(true);
  const [lifetime, setLifetime] = useState('10m');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launches, setLaunches] = useState<LaunchResult[]>([]);

  // Personas
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [newPersona, setNewPersona] = useState({ name: '', country: 'de', city: '', notes: '', lifetime: '24h', confirm: false });
  const [creatingPersona, setCreatingPersona] = useState(false);

  async function refreshPersonas() {
    const r = await api.get<Persona[]>('/personas');
    setPersonas(r.data);
  }

  async function createPersona() {
    if (!newPersona.name || !newPersona.confirm) return;
    setCreatingPersona(true);
    try {
      await api.post('/personas', {
        name: newPersona.name, country: newPersona.country,
        city: newPersona.city, notes: newPersona.notes,
        lifetime: newPersona.lifetime,
        legitimacyConfirmed: newPersona.confirm,
      });
      setNewPersona({ name: '', country: 'de', city: '', notes: '', lifetime: '24h', confirm: false });
      await refreshPersonas();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally { setCreatingPersona(false); }
  }
  async function launchPersona(id: string) {
    try {
      await api.post(`/personas/${id}/launch`);
      await refreshPersonas();
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
  }
  async function deletePersona(id: string, name: string) {
    if (!confirm(`Удалить persona "${name}"? Профиль на диске останется (логины), удали вручную если нужно.`)) return;
    await api.delete(`/personas/${id}`);
    await refreshPersonas();
  }

  async function refresh() {
    const r = await api.get<ProxyStatus>('/proxy/status');
    setStatus(r.data);
    if (r.data.config?.defaultCountry) setCountry(r.data.config.defaultCountry);
    if (r.data.config) setSticky(r.data.config.stickyByDefault);
    if (r.data.config?.stickyLifetime) setLifetime(r.data.config.stickyLifetime);
  }
  useEffect(() => { refresh(); refreshPersonas(); }, []);

  useEffect(() => {
    if (!status?.config) return;
    api.get(`/proxy/build-url-preview?country=${country}&sticky=${sticky}`).then(r => setPreviewUrl(r.data.url));
  }, [country, sticky, status]);

  async function runTest() {
    setTesting(true); setTestResult(null);
    try {
      const r = await api.post<TestResult>('/proxy/test', { country, sticky });
      setTestResult(r.data);
    } catch (e: any) {
      setTestResult({ ok: false, error: e.response?.data?.error || e.message });
    } finally { setTesting(false); }
  }

  async function launchBrowser() {
    setLaunching(true);
    try {
      const r = await api.post<LaunchResult>('/proxy/launch-browser', { country, sticky, lifetime });
      setLaunches(prev => [r.data, ...prev]);
    } finally { setLaunching(false); }
  }

  if (!status) return <div>Загрузка...</div>;

  const configured = status.fileExists && !!status.config;

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <h3 className="font-semibold mb-2">Конфиг IPRoyal</h3>
        <div className="text-xs text-slate-400 mb-2">
          Файл: <code className="text-blue-300 break-all">{status.configFile}</code>
        </div>
        {!status.fileExists && (
          <div className="text-amber-300 text-sm">⚠ Файл не найден — будет создан scraper-control при первом запуске.</div>
        )}
        {status.fileExists && !status.config && (
          <div className="text-amber-300 text-sm">⚠ Файл есть, но username/password не заполнены или содержат placeholder. Открой файл, впиши свои IPRoyal credentials, сохрани.</div>
        )}
        {configured && (
          <div className="grid grid-cols-2 gap-2 text-sm mt-2">
            <div><span className="text-slate-400">User:</span> <code className="text-emerald-300">{status.config.username}</code></div>
            <div><span className="text-slate-400">Password:</span> <code className="text-emerald-300">{status.config.passwordPreview}</code></div>
            <div><span className="text-slate-400">Sticky gateway:</span> <code>{status.config.gatewayHost}:{status.config.gatewayPort}</code></div>
            <div><span className="text-slate-400">Rotating gateway:</span> <code>{status.config.rotatingHost}:{status.config.rotatingPort}</code></div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <h3 className="font-semibold mb-3">Параметры</h3>
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-5">
            <label className="text-xs text-slate-400 block mb-1">Страна exit-IP</label>
            <select value={country} onChange={e => setCountry(e.target.value)} className="w-full px-3 py-2 rounded bg-slate-900/60 border border-slate-700">
              {status.countries.map(c => <option key={c.code} value={c.code}>{c.name} ({c.code.toUpperCase()})</option>)}
            </select>
          </div>
          <div className="col-span-3">
            <label className="text-xs text-slate-400 block mb-1">Sticky (фиксированный IP)</label>
            <button onClick={() => setSticky(s => !s)} className={`w-full px-3 py-2 rounded border ${sticky ? 'bg-blue-600/20 border-blue-500 text-blue-300' : 'bg-slate-900/60 border-slate-700'}`}>
              {sticky ? '✓ Sticky' : 'Rotating'}
            </button>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400 block mb-1">Lifetime (sticky)</label>
            <input value={lifetime} onChange={e => setLifetime(e.target.value)} disabled={!sticky}
              placeholder="10m / 2h" className="w-full px-3 py-2 rounded bg-slate-900/60 border border-slate-700 disabled:opacity-50" />
          </div>
          <div className="col-span-2 flex items-end">
            <button onClick={runTest} disabled={!configured || testing}
              className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-sm">
              {testing ? 'Тест...' : 'Тест IP'}
            </button>
          </div>
        </div>

        {previewUrl && (
          <div className="mt-3 text-xs">
            <div className="text-slate-400">URL preview:</div>
            <code className="font-mono text-slate-300 break-all">{previewUrl}</code>
          </div>
        )}

        {testResult && (
          <div className={`mt-3 p-3 rounded text-sm ${testResult.ok ? 'bg-emerald-500/10 border border-emerald-600/40' : 'bg-red-500/10 border border-red-600/40'}`}>
            {testResult.ok ? (
              <>
                <div className="text-emerald-300 font-semibold">✓ Работает</div>
                <div className="text-slate-300 mt-1">
                  IP: <code>{testResult.ip}</code>
                  {testResult.country && <> · Country: <code>{testResult.country}</code></>}
                  {testResult.latencyMs && <> · {testResult.latencyMs}ms</>}
                </div>
              </>
            ) : (
              <div className="text-red-300">✗ {testResult.error}</div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <h3 className="font-semibold mb-2">Открыть Chrome через прокси</h3>
        <p className="text-sm text-slate-400 mb-3">
          Запустит отдельное окно Chrome с изолированным профилем + автоматической авторизацией прокси.
          Можешь использовать для ручного браузинга через выбранный IP (обход гео-блокировок, тестирование).
        </p>
        <button onClick={launchBrowser} disabled={!configured || launching}
          className="px-5 py-2 rounded bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 font-medium">
          {launching ? 'Запускаю...' : '🌐 Открыть Chrome через прокси'}
        </button>

        {launches.length > 0 && (
          <div className="mt-4">
            <h4 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Запущенные окна</h4>
            <div className="space-y-2">
              {launches.map((l, i) => (
                <div key={i} className={`rounded p-2 text-sm ${l.ok ? 'bg-slate-900/60 border border-slate-700' : 'bg-red-500/10 border border-red-600/40'}`}>
                  {l.ok ? (
                    <>
                      <span className="text-emerald-300">✓</span> PID {l.pid} ·
                      proxy: <code>{l.proxyHost}:{l.proxyPort}</code> ·
                      country: <code>{l.country}</code>
                    </>
                  ) : (
                    <span className="text-red-300">✗ {l.error}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <h3 className="font-semibold mb-2">🎭 Persona — постоянная идентичность</h3>
        <p className="text-sm text-slate-400 mb-3">
          Persona = фиксированный sticky-IP + изолированный Chrome-профиль (логины и cookies сохраняются между запусками).
          Полезно для: твоего реального немецкого Google-аккаунта, корпоративного multi-location, тестирования геолокации.
        </p>
        <div className="rounded bg-amber-500/10 border border-amber-600/40 p-3 mb-4 text-xs text-amber-200">
          <b>⚠ Юридический момент:</b> фейковые отзывы — нарушение Google ToS и немецкого UWG §5
          (Lauterkeitsrecht), штрафы могут быть существенными. Используй ТОЛЬКО для реальных собственных аккаунтов
          или с явным раскрытием affiliation для multi-location бизнеса.
        </div>

        <details className="mb-4">
          <summary className="cursor-pointer text-sm font-medium hover:text-blue-300">+ Создать новую persona</summary>
          <div className="mt-3 grid grid-cols-12 gap-2">
            <input value={newPersona.name} onChange={e => setNewPersona(p => ({ ...p, name: e.target.value }))}
              placeholder="Имя (Hans Berlin)" className="col-span-3 px-3 py-2 rounded bg-slate-900/60 border border-slate-700 text-sm" />
            <select value={newPersona.country} onChange={e => setNewPersona(p => ({ ...p, country: e.target.value }))}
              className="col-span-2 px-2 py-2 rounded bg-slate-900/60 border border-slate-700 text-sm">
              {status.countries.map(c => <option key={c.code} value={c.code}>{c.code.toUpperCase()}</option>)}
            </select>
            <input value={newPersona.city} onChange={e => setNewPersona(p => ({ ...p, city: e.target.value }))}
              placeholder="Город (Berlin)" className="col-span-2 px-3 py-2 rounded bg-slate-900/60 border border-slate-700 text-sm" />
            <input value={newPersona.lifetime} onChange={e => setNewPersona(p => ({ ...p, lifetime: e.target.value }))}
              placeholder="24h" className="col-span-1 px-3 py-2 rounded bg-slate-900/60 border border-slate-700 text-sm" />
            <input value={newPersona.notes} onChange={e => setNewPersona(p => ({ ...p, notes: e.target.value }))}
              placeholder="Заметка" className="col-span-4 px-3 py-2 rounded bg-slate-900/60 border border-slate-700 text-sm" />
            <label className="col-span-9 flex items-start gap-2 text-xs text-slate-300 mt-1">
              <input type="checkbox" checked={newPersona.confirm}
                onChange={e => setNewPersona(p => ({ ...p, confirm: e.target.checked }))} className="mt-0.5" />
              <span>Подтверждаю: persona легитимна (мой реальный аккаунт ИЛИ корпоративный multi-location). Не использую для фейковых отзывов.</span>
            </label>
            <button onClick={createPersona} disabled={!newPersona.name || !newPersona.confirm || creatingPersona}
              className="col-span-3 px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-sm">
              {creatingPersona ? 'Создаю...' : 'Создать'}
            </button>
          </div>
        </details>

        <div className="space-y-2">
          {personas.length === 0 && <div className="text-sm text-slate-500">Personas пока нет</div>}
          {personas.map(p => (
            <div key={p._id} className="rounded border border-slate-700/50 bg-slate-900/40 p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">{p.name}</span>
                  <code className="text-xs text-slate-500">{p.country.toUpperCase()}{p.city ? ` · ${p.city}` : ''}</code>
                  <code className="text-xs text-slate-500">session-{p.proxySessionId}</code>
                </div>
                {p.notes && <div className="text-xs text-slate-400 mt-0.5">{p.notes}</div>}
                <div className="text-xs text-slate-500 mt-0.5">
                  Profile: <code className="break-all">{p.profileDir.split(/[\\/]/).pop()}</code>
                  {p.lastUsedAt && <> · last used {new Date(p.lastUsedAt).toLocaleString('ru')}</>}
                </div>
              </div>
              <button onClick={() => launchPersona(p._id)}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-sm shrink-0">
                🌐 Открыть
              </button>
              <button onClick={() => deletePersona(p._id, p.name)}
                className="px-2 py-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 text-xs shrink-0">
                удалить
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <h3 className="font-semibold mb-2">Использование с скраперами</h3>
        <p className="text-sm text-slate-400">
          Чтобы конкретный скрапер запускался через прокси — на странице <b>Скраперы</b> добавь к args
          переменную окружения через интерфейс (Phase 2 фича) ИЛИ сейчас — экспортируй в .env:
        </p>
        <pre className="mt-2 p-2 bg-slate-900/60 rounded text-xs">
{`HTTPS_PROXY=http://user:pass_country-de@geo.iproyal.com:12321
HTTP_PROXY=http://user:pass_country-de@geo.iproyal.com:12321`}
        </pre>
        <p className="text-xs text-slate-500 mt-2">
          axios + node-fetch автоматически уважают эти env vars если HTTP_PROXY_AGENT настроен в коде скрипта.
          Не все existing скраперы поддерживают — нужна доработка per-scraper. Pupperteer-радар работает напрямую через
          --proxy-server в Chrome args (нужна доработка).
        </p>
      </section>
    </div>
  );
}
