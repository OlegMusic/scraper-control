import { useEffect, useState } from 'react';
import { api } from '../api';

interface Provider {
  _id: string;
  name: string;
  phone?: string;
  email?: string[];
  website?: string;
  socials?: Record<string, string>;
  address?: string;
  city?: string;
  category?: string;
  externalSources?: string[];
  youtubePublishedAt?: string;
  youtubeChannelTitle?: string;
  rating?: number;
  ratingCount?: number;
  photos?: string[];
  radarMeta?: any;
  updatedAt?: string;
  audit?: { websiteScore?: number; socialScore?: number; overallNeed?: string; recommendations?: string[]; auditedAt?: string; signals?: any; };
  whois?: { registered?: string; expires?: string; registrar?: string };
  youtubeSubscribers?: string;
  youtubeVideoCount?: string;
  youtubeViewCount?: string;
  youtubeCountry?: string;
  youtubeChannelDescription?: string;
  avatarUrl?: string;
}

interface Metrics {
  total: number;
  handwerker: number;
  researchers: number;
  weakness: { weakSite: number; noEmail: number; noPhone: number; noSocials: number; noPhotos: number; noRating: number; weakAll: number; };
  strength: { youtubeWithDate: number; websiteAndSocials: number; fullData: number; };
  ageGroups: Array<{ _id: any; n: number }>;
  audit?: { total: number; critical: number; major: number; minor: number; none: number; lastWeek: number; };
  whois?: { total: number; young: number; old: number; };
}

interface SmartTarget { id: string; label: string; description: string; count: number; }

function VerdictBadge({ need, score }: { need: string; score?: number }) {
  const map: Record<string, { color: string; emoji: string; label: string }> = {
    critical: { color: 'bg-red-500/20 text-red-300 border-red-500/40', emoji: '🚨', label: 'Critical' },
    major:    { color: 'bg-amber-500/20 text-amber-300 border-amber-500/40', emoji: '🟠', label: 'Major' },
    minor:    { color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40', emoji: '🟡', label: 'Minor' },
    none:     { color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', emoji: '🟢', label: 'OK' },
  };
  const m = map[need] || { color: 'bg-slate-700 text-slate-400', emoji: '·', label: need };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] ${m.color}`}>
      {m.emoji} {m.label}{typeof score === 'number' && <span className="opacity-70">{score.toFixed(1)}</span>}
    </span>
  );
}

function MetricTile({ label, value, of, color, onClick, missingLabel }: {
  label: string; value: number; of: number; color: 'blue' | 'emerald' | 'purple' | 'amber';
  onClick?: () => void; missingLabel?: string;
}) {
  const pct = of > 0 ? (100 * value / of) : 0;
  const missing = of - value;
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500/30 to-blue-500/5 border-blue-400/30 hover:from-blue-500/40',
    emerald: 'from-emerald-500/30 to-emerald-500/5 border-emerald-400/30 hover:from-emerald-500/40',
    purple: 'from-purple-500/30 to-purple-500/5 border-purple-400/30 hover:from-purple-500/40',
    amber: 'from-amber-500/30 to-amber-500/5 border-amber-400/30 hover:from-amber-500/40',
  };
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`text-left rounded-2xl border bg-gradient-to-br ${colorMap[color]} p-4 transition-all ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:shadow-xl' : ''}`}>
      <div className="text-xs uppercase tracking-wider text-slate-300/80">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString()}</div>
      <div className="text-xs text-slate-300/60 mt-0.5">{pct.toFixed(0)}% покрытия</div>
      <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full bg-white/40 transition-all" style={{ width: `${pct}%` }}></div>
      </div>
      {onClick && missingLabel && missing > 0 && (
        <div className="mt-2 text-xs text-amber-300/90 hover:text-amber-200">
          → {missingLabel}: {missing.toLocaleString()}
        </div>
      )}
    </button>
  );
}

export function Database() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [total, setTotal] = useState(0);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [skip, setSkip] = useState(0);
  const limit = 50;
  const [filter, setFilter] = useState({ city: '', category: '', source: '', name: '', hasEmail: '', hasWebsite: '', hasSocials: '', sort: 'updated' });
  const [selected, setSelected] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(false);
  const [smartTargets, setSmartTargets] = useState<SmartTarget[]>([]);
  const [activeTarget, setActiveTarget] = useState<string | null>(null);

  // DB chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput('');
    const next = [...chatMessages, { role: 'user' as const, content: text }];
    setChatMessages(next);
    setChatLoading(true);
    try {
      const r = await api.post<{ reply: string }>('/db-chat/chat', { messages: next });
      setChatMessages([...next, { role: 'assistant', content: r.data.reply }]);
    } catch (e: any) {
      setChatMessages([...next, { role: 'assistant', content: `❌ ${e.response?.data?.error || e.message}` }]);
    } finally { setChatLoading(false); }
  }

  async function loadTarget(id: string) {
    setActiveTarget(id);
    setLoading(true);
    setSkip(0);
    const r = await api.get(`/database/smart-targets/${id}`, { params: { limit, skip: 0 } });
    setProviders(r.data.items);
    setTotal(r.data.total);
    setLoading(false);
    // Scroll к таблице — иначе клик на target кажется без эффекта (таблица далеко вниз)
    setTimeout(() => {
      document.getElementById('providers-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  async function load() {
    if (activeTarget) {
      const r = await api.get(`/database/smart-targets/${activeTarget}`, { params: { limit, skip } });
      setProviders(r.data.items);
      setTotal(r.data.total);
      return;
    }
    setLoading(true);
    const params: any = { limit, skip };
    for (const [k, v] of Object.entries(filter)) {
      if (v) params[k] = v;
    }
    const r = await api.get('/database/providers', { params });
    setProviders(r.data.items);
    setTotal(r.data.total);
    setLoading(false);
  }
  useEffect(() => { load(); }, [skip, filter]);
  useEffect(() => {
    api.get<Metrics>('/database/metrics').then(r => setMetrics(r.data));
    api.get<SmartTarget[]>('/database/smart-targets').then(r => setSmartTargets(r.data));
  }, []);

  function clearTarget() { setActiveTarget(null); setSkip(0); }

  function setF(key: keyof typeof filter, value: string) {
    setSkip(0);
    setFilter(p => ({ ...p, [key]: value }));
  }

  function pct(n: number, total: number) { return total ? (100 * n / total).toFixed(1) : '0'; }

  return (
    <div className="space-y-4 relative">
      {/* Chat moved to GlobalChat in Shell */}
      {false && (
        <div className="fixed bottom-24 right-6 z-40 w-[480px] max-h-[600px] flex flex-col rounded-lg border border-slate-700/50 bg-slate-800/95 backdrop-blur shadow-2xl">
          <div className="px-4 py-2 border-b border-slate-700/50 flex items-center justify-between">
            <span className="font-semibold text-sm">💬 Database Chat</span>
            <div className="flex gap-2">
              <button onClick={() => setChatMessages([])} className="text-xs text-slate-400 hover:text-white">очистить</button>
              <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-white">×</button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-3 min-h-[300px]">
            {chatMessages.length === 0 && (
              <div className="text-xs text-slate-400 space-y-2">
                <p>Спрашивай что угодно про базу. Примеры:</p>
                <div className="space-y-1">
                  {[
                    'Сколько Handwerker в Berlin без сайта?',
                    'Покажи Friseur с TikTok',
                    'Кто зарегистрировал YT канал в 2024?',
                    'Сравни coverage email по Top 10 городов',
                    'Найди Tischler с websiteText короче 200 символов (слабый сайт)',
                  ].map(s => (
                    <button key={s} onClick={() => { setChatInput(s); }}
                      className="block text-left px-2 py-1 rounded bg-slate-700/30 hover:bg-slate-700/50 text-slate-300 w-full">
                      "{s}"
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-700/50 text-slate-100 whitespace-pre-wrap'
                }`}>{m.content}</div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start"><div className="rounded-xl px-3 py-2 bg-slate-700/50 text-slate-300 text-sm animate-pulse">Запрос к БД...</div></div>
            )}
          </div>
          <div className="border-t border-slate-700/50 p-2 flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder="Спроси про базу..."
              className="flex-1 px-3 py-2 rounded bg-slate-900/60 border border-slate-700 text-sm" />
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
              className="px-3 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-sm">➤</button>
          </div>
        </div>
      )}
      {/* HERO */}
      {metrics && (
        <section className="relative overflow-hidden rounded-3xl border border-white/10 hero-gradient p-8 mb-6">
          <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-blue-500/20 blur-3xl"></div>
          <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-purple-500/20 blur-3xl"></div>
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              {metrics.total.toLocaleString()}
            </h1>
            <p className="text-slate-400 mt-1">
              записей в базе · <span className="text-emerald-400 font-medium">{metrics.handwerker.toLocaleString()}</span> Handwerker
              {' · '}<span className="text-blue-400 font-medium">{metrics.researchers.toLocaleString()}</span> Researchers
            </p>

            <div className="grid grid-cols-4 gap-3 mt-6">
              <MetricTile label="Сайт" value={metrics.total - metrics.weakness.weakSite} of={metrics.total} color="blue"
                missingLabel="без сайта" onClick={() => loadTarget('need-website')} />
              <MetricTile label="Email" value={metrics.total - metrics.weakness.noEmail} of={metrics.total} color="emerald"
                missingLabel="без email" onClick={() => loadTarget('need-email')} />
              <MetricTile label="Соцсети" value={metrics.total - metrics.weakness.noSocials} of={metrics.total} color="purple"
                missingLabel="без соцсетей" onClick={() => loadTarget('need-socials')} />
              <MetricTile label="Фото" value={metrics.total - metrics.weakness.noPhotos} of={metrics.total} color="amber"
                missingLabel="без фото" onClick={() => loadTarget('need-photos')} />
            </div>

            {/* Audit verdict bar */}
            {metrics.audit && metrics.audit.total > 0 && (
              <div className="mt-6 grid grid-cols-5 gap-2">
                <button onClick={() => loadTarget('audit-critical')}
                  className="rounded-2xl border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 p-3 text-left transition">
                  <div className="text-xs uppercase tracking-wider text-red-300">🚨 Critical</div>
                  <div className="text-xl font-semibold mt-0.5">{metrics.audit.critical.toLocaleString()}</div>
                </button>
                <button onClick={() => loadTarget('audit-major')}
                  className="rounded-2xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 p-3 text-left transition">
                  <div className="text-xs uppercase tracking-wider text-amber-300">🟠 Major</div>
                  <div className="text-xl font-semibold mt-0.5">{metrics.audit.major.toLocaleString()}</div>
                </button>
                <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-3">
                  <div className="text-xs uppercase tracking-wider text-yellow-300">🟡 Minor</div>
                  <div className="text-xl font-semibold mt-0.5">{metrics.audit.minor.toLocaleString()}</div>
                </div>
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="text-xs uppercase tracking-wider text-emerald-300">🟢 OK</div>
                  <div className="text-xl font-semibold mt-0.5">{metrics.audit.none.toLocaleString()}</div>
                </div>
                <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-3">
                  <div className="text-xs uppercase tracking-wider text-slate-400">Audited</div>
                  <div className="text-xl font-semibold mt-0.5">{metrics.audit.total.toLocaleString()}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{metrics.audit.lastWeek.toLocaleString()} за 7д</div>
                </div>
              </div>
            )}

            {/* WHOIS bar */}
            {metrics.whois && metrics.whois.total > 0 && (
              <div className="mt-3 flex gap-2 text-xs">
                <div className="px-3 py-1.5 rounded-full bg-slate-800/60 border border-slate-700">
                  WHOIS scanned: <b className="text-blue-300">{metrics.whois.total.toLocaleString()}</b>
                </div>
                <div className="px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-600/40">
                  🆕 Молодые домены &lt;2y: <b className="text-emerald-300">{metrics.whois.young.toLocaleString()}</b>
                </div>
                <div className="px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-600/40">
                  🏛 Старые &gt;10y: <b className="text-blue-300">{metrics.whois.old.toLocaleString()}</b>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* SMART TARGETS — preset кнопки для outreach */}
      <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-slate-500">🎯 Умный отбор контактов</h3>
          {activeTarget && (
            <button onClick={clearTarget} className="text-xs text-slate-400 hover:text-white">× сбросить targets</button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {smartTargets.map(t => (
            <button key={t.id} onClick={() => loadTarget(t.id)}
              className={`text-left p-3 rounded-lg border transition ${
                activeTarget === t.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-700 bg-slate-900/40 hover:bg-slate-700/40'
              }`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-sm">{t.label}</span>
                <span className="text-xs text-slate-400 shrink-0">{t.count.toLocaleString()}</span>
              </div>
              <div className="text-xs text-slate-400 mt-1">{t.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* FILTERS */}
      <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 grid grid-cols-12 gap-2">
        <input value={filter.name} onChange={e => setF('name', e.target.value)} placeholder="Имя"
          className="col-span-2 px-2 py-1.5 rounded bg-slate-900/60 border border-slate-700 text-sm" />
        <input value={filter.city} onChange={e => setF('city', e.target.value)} placeholder="Город"
          className="col-span-2 px-2 py-1.5 rounded bg-slate-900/60 border border-slate-700 text-sm" />
        <input value={filter.category} onChange={e => setF('category', e.target.value)} placeholder="Категория"
          className="col-span-2 px-2 py-1.5 rounded bg-slate-900/60 border border-slate-700 text-sm" />
        <input value={filter.source} onChange={e => setF('source', e.target.value)} placeholder="Source"
          className="col-span-2 px-2 py-1.5 rounded bg-slate-900/60 border border-slate-700 text-sm" />
        <select value={filter.hasEmail} onChange={e => setF('hasEmail', e.target.value)}
          className="col-span-1 px-2 py-1.5 rounded bg-slate-900/60 border border-slate-700 text-sm">
          <option value="">Email: все</option>
          <option value="true">✓ есть</option>
          <option value="false">✗ нет</option>
        </select>
        <select value={filter.hasWebsite} onChange={e => setF('hasWebsite', e.target.value)}
          className="col-span-1 px-2 py-1.5 rounded bg-slate-900/60 border border-slate-700 text-sm">
          <option value="">Сайт: все</option>
          <option value="true">✓ есть</option>
          <option value="false">✗ нет</option>
        </select>
        <select value={filter.hasSocials} onChange={e => setF('hasSocials', e.target.value)}
          className="col-span-1 px-2 py-1.5 rounded bg-slate-900/60 border border-slate-700 text-sm">
          <option value="">Соц: все</option>
          <option value="true">✓ есть</option>
        </select>
        <select value={filter.sort} onChange={e => setF('sort', e.target.value)}
          className="col-span-1 px-2 py-1.5 rounded bg-slate-900/60 border border-slate-700 text-sm">
          <option value="updated">Updated</option>
          <option value="oldest">Старейший YT</option>
          <option value="newest">Новейший YT</option>
          <option value="name">По имени</option>
        </select>
      </section>

      {/* TABLE */}
      <section id="providers-table" className="rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden scroll-mt-24">
        <div className="px-3 py-2 border-b border-slate-700/50 flex items-center justify-between text-sm">
          <span>Найдено: <b>{total.toLocaleString()}</b> {loading && <span className="text-slate-500">· загрузка...</span>}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSkip(Math.max(0, skip - limit))} disabled={skip === 0}
              className="px-2 py-1 rounded bg-slate-700/40 disabled:opacity-50 text-xs">←</button>
            <span className="text-xs text-slate-400">{skip + 1}–{Math.min(skip + limit, total)}</span>
            <button onClick={() => setSkip(skip + limit)} disabled={skip + limit >= total}
              className="px-2 py-1 rounded bg-slate-700/40 disabled:opacity-50 text-xs">→</button>
          </div>
        </div>
        <div className="overflow-auto max-h-[600px]">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/60 sticky top-0">
              <tr className="text-left text-slate-400">
                <th className="px-3 py-2">Имя</th>
                <th className="px-3 py-2">Город / Категория</th>
                <th className="px-3 py-2">Verdict</th>
                <th className="px-3 py-2">Сайт</th>
                <th className="px-3 py-2">📞✉</th>
                <th className="px-3 py-2">Соц</th>
                <th className="px-3 py-2">YT</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {providers.map(p => (
                <tr key={p._id}
                  className="border-t border-slate-700/30 hover:bg-blue-500/5">
                  <td className="px-3 py-2 font-medium cursor-pointer" onClick={() => setSelected(p)}>
                    {p.name?.slice(0, 60)}
                  </td>
                  <td className="px-3 py-2 text-slate-400 cursor-pointer" onClick={() => setSelected(p)}>
                    {p.city} · {p.category?.slice(0, 24)}
                  </td>
                  <td className="px-3 py-2">
                    {p.audit?.overallNeed ? <VerdictBadge need={p.audit.overallNeed} score={p.audit.websiteScore} /> : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {p.website
                      ? <a href={p.website} target="_blank" onClick={e => e.stopPropagation()}
                          className="text-blue-300 hover:text-blue-200 hover:underline truncate inline-block max-w-[160px]"
                          title={p.website}>{p.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}</a>
                      : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.phone && <span title={p.phone}>📞</span>}
                    {p.email?.[0] && <a href={`mailto:${p.email[0]}`} onClick={e => e.stopPropagation()} title={p.email[0]} className="ml-1">✉</a>}
                  </td>
                  <td className="px-3 py-2">
                    {p.socials?.instagram && <a href={p.socials.instagram} target="_blank" onClick={e => e.stopPropagation()} title="Instagram">📷</a>}
                    {p.socials?.facebook && <a href={p.socials.facebook} target="_blank" onClick={e => e.stopPropagation()} title="Facebook">📘</a>}
                    {p.socials?.youtube && <a href={p.socials.youtube} target="_blank" onClick={e => e.stopPropagation()} title="YouTube">📺</a>}
                    {p.socials?.tiktok && <a href={p.socials.tiktok} target="_blank" onClick={e => e.stopPropagation()} title="TikTok">🎵</a>}
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {p.youtubePublishedAt ? new Date(p.youtubePublishedAt).getFullYear() : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setSelected(p)} className="text-blue-300 hover:text-blue-200">детали →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* DETAIL MODAL */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={() => setSelected(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-auto p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-xl font-semibold">{selected.name}</h2>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white">×</button>
            </div>
            <div className="text-sm text-slate-300 space-y-1">
              <div><b>Город:</b> {selected.city} · <b>Категория:</b> {selected.category}</div>
              <div><b>Адрес:</b> {selected.address}</div>
              {selected.phone && <div><b>📞 Phone:</b> {selected.phone}</div>}
              {selected.email?.length ? <div><b>✉ Email:</b> {selected.email.join(', ')}</div> : null}
              {selected.website && <div><b>🌐 Website:</b> <a href={selected.website} target="_blank" className="text-blue-300 hover:underline">{selected.website}</a></div>}
              {selected.socials && Object.keys(selected.socials).length > 0 && (
                <div><b>Социальные сети:</b>
                  <ul className="ml-4 mt-1">
                    {Object.entries(selected.socials).map(([k, v]) => v && <li key={k}>{k}: <a href={String(v)} target="_blank" className="text-blue-300 hover:underline">{String(v)}</a></li>)}
                  </ul>
                </div>
              )}
              {selected.youtubePublishedAt && (
                <div><b>YT канал создан:</b> {new Date(selected.youtubePublishedAt).toLocaleDateString('de-DE')}
                  {' '}({Math.floor((Date.now() - +new Date(selected.youtubePublishedAt)) / 31536000000)} лет назад)</div>
              )}
              {selected.youtubeChannelTitle && <div><b>YT title:</b> {selected.youtubeChannelTitle}</div>}
              {(selected.youtubeSubscribers || selected.youtubeVideoCount || selected.youtubeViewCount) && (
                <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/30">
                  <div className="text-xs uppercase text-red-300 mb-1">📺 YouTube статистика</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {selected.youtubeSubscribers && <div>👥 Subs: <b>{Number(selected.youtubeSubscribers).toLocaleString()}</b></div>}
                    {selected.youtubeVideoCount && <div>🎬 Videos: <b>{Number(selected.youtubeVideoCount).toLocaleString()}</b></div>}
                    {selected.youtubeViewCount && <div>👁 Views: <b>{Number(selected.youtubeViewCount).toLocaleString()}</b></div>}
                  </div>
                </div>
              )}
              {selected.whois?.registered && (
                <div><b>🌐 Домен зарегистрирован:</b> {new Date(selected.whois.registered).toLocaleDateString('de-DE')}
                  {' '}({Math.floor((Date.now() - +new Date(selected.whois.registered)) / 31536000000)} лет назад)
                  {selected.whois.registrar && <> · <span className="text-slate-400">{selected.whois.registrar}</span></>}
                </div>
              )}

              {/* AUDIT VERDICT */}
              {selected.audit?.overallNeed && (
                <div className="mt-4 p-3 rounded-lg border border-slate-700 bg-slate-900/40">
                  <div className="flex items-baseline gap-2 mb-2">
                    <b>🤖 Audit Verdict:</b>
                    <VerdictBadge need={selected.audit.overallNeed} score={selected.audit.websiteScore} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                    <div>Website score: <b className="text-blue-300">{selected.audit.websiteScore?.toFixed(1)}/10</b></div>
                    <div>Social score: <b className="text-purple-300">{selected.audit.socialScore?.toFixed(1)}/10</b></div>
                  </div>
                  {selected.audit.recommendations && selected.audit.recommendations.length > 0 && (
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Услуги для предложения:</div>
                      <div className="flex flex-wrap gap-1">
                        {selected.audit.recommendations.map(r => (
                          <span key={r} className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 text-xs border border-blue-500/30">{r}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.audit.signals?.web?.cms && (
                    <div className="text-xs text-slate-400 mt-2">CMS: <code className="text-amber-300">{selected.audit.signals.web.cms}</code></div>
                  )}
                  {selected.audit.auditedAt && (
                    <div className="text-xs text-slate-500 mt-2">Audited {new Date(selected.audit.auditedAt).toLocaleString('ru')}</div>
                  )}
                </div>
              )}
              {typeof selected.rating === 'number' && selected.rating > 0 && (
                <div><b>Рейтинг:</b> {selected.rating} ({selected.ratingCount} reviews)</div>
              )}
              {selected.radarMeta && (
                <details>
                  <summary className="cursor-pointer text-blue-300">radarMeta</summary>
                  <pre className="text-xs bg-slate-900/60 p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(selected.radarMeta, null, 2)}</pre>
                </details>
              )}
              <div className="text-xs text-slate-500 mt-3">
                Sources: {selected.externalSources?.join(', ')}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
