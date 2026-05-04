import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { BulkSeoJobsPanel } from '../components/BulkSeoJobsPanel';
import { TrainingFeedbackPanel } from '../components/TrainingFeedbackPanel';

interface SeoStatus {
  seeds: { total: number; processed: number; pending: number };
  keywords: number;
  lastRun: any;
  sources: {
    googleAds: { configured: boolean };
    dataForSeo: { configured: boolean };
    gsc: { configured: boolean };
  };
}

interface Coverage {
  totalKeywords: number;
  uniquePairs: number;
  pairsBreakdown: Array<{ category: string; cities: number; keywords: number }>;
}

interface Keyword {
  _id: string;
  keyword: string;
  city?: string;
  category?: string;
  avgMonthlySearches: number;
  serpDifficulty: number;
  competitionIndex: number;
  bidLow: number;
  bidHigh: number;
  opportunityScore: number;
  gscOurPosition?: number;
  gscOurImpressions?: number;
  sources: string[];
  serpTop10?: Array<{ position: number; domain: string; url: string; title: string }>;
}

interface HeatmapCell {
  _id: { category: string; city: string };
  keywords: number;
  totalVolume: number;
  avgScore: number;
  maxScore: number;
}

export function SEO() {
  const [status, setStatus] = useState<SeoStatus | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Keyword | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);

  async function refresh() {
    const [s, c] = await Promise.all([
      api.get<SeoStatus>('/seo/status'),
      api.get<Coverage>('/seo/coverage'),
    ]);
    setStatus(s.data);
    setCoverage(c.data);
  }
  async function loadKeywords() {
    const params: any = { limit: 100 };
    if (filterCategory) params.category = filterCategory;
    if (filterCity) params.city = filterCity;
    const r = await api.get<{ items: Keyword[] }>('/seo/keywords', { params });
    setKeywords(r.data.items);
  }
  async function loadHeatmap() {
    const r = await api.get<{ cells: HeatmapCell[] }>('/seo/heatmap');
    setHeatmap(r.data.cells);
  }
  useEffect(() => { refresh(); loadKeywords(); loadHeatmap(); }, []);
  useEffect(() => { loadKeywords(); }, [filterCategory, filterCity]);

  async function action(name: string, run: () => Promise<any>, msg?: string) {
    setBusy(name);
    try {
      const r = await run();
      alert(msg || `OK: ${JSON.stringify(r.data)}`);
      await refresh();
      await loadKeywords();
      await loadHeatmap();
    } catch (e: any) {
      alert(`Ошибка: ${e.response?.data?.error || e.message}`);
    } finally { setBusy(null); }
  }

  const heatCellMatrix = useMemo(() => {
    const cats = new Set<string>();
    const cities = new Set<string>();
    for (const c of heatmap) {
      if (!c?._id) continue;
      if (c._id.category) cats.add(c._id.category);
      if (c._id.city) cities.add(c._id.city);
    }
    const sortedCats = Array.from(cats).slice(0, 20);
    const sortedCities = Array.from(cities).slice(0, 15);
    const lookup = new Map<string, HeatmapCell>();
    for (const c of heatmap) {
      if (!c?._id?.category || !c?._id?.city) continue;
      lookup.set(`${c._id.category}|${c._id.city}`, c);
    }
    return { cats: sortedCats, cities: sortedCities, lookup };
  }, [heatmap]);

  if (!status) return <div className="text-slate-400">Загрузка...</div>;

  const sourceBadge = (label: string, on: boolean) => (
    <span className={`px-2 py-0.5 rounded-full text-xs ${on ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/40 text-slate-400'}`}>
      {label}: {on ? '✓' : '✗ не настроен'}
    </span>
  );

  return (
    <div className="space-y-6">
      {/* HERO */}
      <section className="rounded-3xl border border-white/10 hero-gradient p-6">
        <h1 className="text-2xl font-semibold mb-2">SEO Intelligence Pipeline</h1>
        <p className="text-slate-400 text-sm mb-4">
          Research keywords для Site Factory. Источники: Google Ads (volume), DataForSEO (SERP), GSC (наши данные).
        </p>

        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">Seeds (запросы для исследования)</div>
            <div className="text-2xl font-semibold mt-1">{(status.seeds?.total || 0).toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-1">обработано {(status.seeds?.processed || 0).toLocaleString()}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">Keywords с metrics</div>
            <div className="text-2xl font-semibold mt-1">{(status.keywords || 0).toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-1">с volume + SERP</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">Coverage</div>
            <div className="text-2xl font-semibold mt-1">{(coverage?.uniquePairs || 0).toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-1">category × city pairs</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">Last run</div>
            <div className="text-sm font-medium mt-1">{status.lastRun?.source || '—'}</div>
            <div className="text-xs text-slate-400 mt-1">{status.lastRun?.status || ''}</div>
          </div>
        </div>

        <div className="flex gap-2 mt-4 flex-wrap">
          {sourceBadge('Google Ads API', status.sources.googleAds.configured)}
          {sourceBadge('DataForSEO', status.sources.dataForSeo.configured)}
          {sourceBadge('Google Search Console', status.sources.gsc.configured)}
        </div>
      </section>

      {/* PIPELINE CONTROLS */}
      <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
        <h3 className="font-semibold mb-3">Pipeline Controls</h3>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <button
            disabled={!!busy}
            onClick={() => action('seed', () => api.post('/seo/research/seed', { topCities: 60, topPlz: 100 }), 'Seeds сгенерированы')}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-3 text-sm font-medium">
            {busy === 'seed' ? 'Генерация...' : '1️⃣ Сгенерировать seeds'}
          </button>
          <button
            disabled={!!busy}
            onClick={() => action('autocomplete', () => api.post('/seo/research/autocomplete', { limitSeeds: 30, sources: ['google', 'bing'], depth: 2 }), 'Autocomplete расширен')}
            className="rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 px-4 py-3 text-sm font-medium">
            {busy === 'autocomplete' ? 'Расширение...' : '2️⃣🆓 Autocomplete (Google+Bing)'}
          </button>
          <button
            disabled={!!busy}
            onClick={() => action('estVol', () => api.post('/seo/research/estimate-volume', { limit: 100 }), 'Volume estimated heuristically')}
            className="rounded-xl bg-cyan-700 hover:bg-cyan-800 disabled:opacity-50 px-4 py-3 text-sm font-medium">
            {busy === 'estVol' ? 'Оценка...' : '3️⃣🆓 Volume heuristic'}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <button
            disabled={!!busy || !status.sources.googleAds.configured}
            onClick={() => action('gads', () => api.post('/seo/research/google-ads', { limit: 1000 }), 'Volume пуллнут')}
            className="rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-4 py-3 text-sm font-medium">
            {busy === 'gads' ? 'Pull...' : '4️⃣💰 Google Ads (точный volume)'}
          </button>
          <button
            disabled={!!busy || !status.sources.dataForSeo.configured}
            onClick={() => action('serp', () => api.post('/seo/research/serp', { minVolume: 50, limit: 100 }), 'SERP проанализирован')}
            className="rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-4 py-3 text-sm font-medium">
            {busy === 'serp' ? 'SERP...' : '5️⃣💰 SERP (DataForSEO)'}
          </button>
          <button
            disabled={!!busy || !status.sources.gsc.configured}
            onClick={() => action('gsc', () => api.post('/seo/research/gsc', {}), 'GSC данные подтянуты')}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-4 py-3 text-sm font-medium">
            {busy === 'gsc' ? 'GSC...' : '6️⃣ GSC sync (свои сайты)'}
          </button>
        </div>
        <div className="text-xs text-slate-500 mt-3 space-y-1">
          <div>🆓 — работает без API tokens (rate-limited).</div>
          <div>💰 — нужны API tokens (Google Ads dev token / DataForSEO login). Лучшие данные но платно.</div>
          <div>Минимальный поток: 1 → 2 → 3 → (5 если есть DataForSEO) → 6 (если есть GSC).</div>
        </div>
      </section>

      {/* BULK JOBS */}
      <BulkSeoJobsPanel />

      {/* HEATMAP */}
      {heatCellMatrix.cats.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 overflow-auto">
          <h3 className="font-semibold mb-3">Heatmap: Category × City — Opportunity Score (max)</h3>
          <table className="text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left p-2 sticky left-0 bg-slate-900">Category \ City</th>
                {heatCellMatrix.cities.map(c => <th key={c} className="p-2 text-left">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {heatCellMatrix.cats.map(cat => (
                <tr key={cat}>
                  <td className="p-2 sticky left-0 bg-slate-900 font-medium">{cat.slice(0, 25)}</td>
                  {heatCellMatrix.cities.map(city => {
                    const cell = heatCellMatrix.lookup.get(`${cat}|${city}`);
                    if (!cell) return <td key={city} className="p-2 text-slate-700">·</td>;
                    const maxScore = cell.maxScore || 0;
                    const totalVolume = cell.totalVolume || 0;
                    const keywordCount = cell.keywords || 0;
                    const intensity = Math.min(1, maxScore / 1000);
                    return (
                      <td key={city} className="p-1">
                        <button
                          onClick={() => { setFilterCategory(cat); setFilterCity(city); }}
                          className="w-12 h-8 rounded text-[10px] font-mono"
                          style={{
                            background: `rgba(99, 102, 241, ${intensity * 0.6})`,
                            border: '1px solid rgba(99, 102, 241, 0.3)',
                          }}
                          title={`${keywordCount} keywords, total vol ${totalVolume.toLocaleString()}, max score ${maxScore.toFixed(1)}`}>
                          {Math.round(maxScore)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* KEYWORDS LIST */}
      <section className="rounded-2xl border border-white/10 bg-slate-900/40 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3">
          <h3 className="font-semibold">Keywords</h3>
          <input value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            placeholder="Категория" className="px-3 py-1.5 rounded bg-slate-800 border border-white/10 text-sm" />
          <input value={filterCity} onChange={e => setFilterCity(e.target.value)}
            placeholder="Город" className="px-3 py-1.5 rounded bg-slate-800 border border-white/10 text-sm" />
          <span className="ml-auto text-xs text-slate-400">{keywords.length} показано</span>
        </div>
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/80 sticky top-0">
              <tr className="text-left text-slate-400">
                <th className="px-3 py-2">Keyword</th>
                <th className="px-3 py-2">Cat / City</th>
                <th className="px-3 py-2 text-right">Volume</th>
                <th className="px-3 py-2 text-right">Difficulty</th>
                <th className="px-3 py-2 text-right">Comp</th>
                <th className="px-3 py-2 text-right">Bid €</th>
                <th className="px-3 py-2 text-right">Score</th>
                <th className="px-3 py-2">Sources</th>
                <th className="px-3 py-2">GSC</th>
              </tr>
            </thead>
            <tbody>
              {keywords.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-slate-500">
                  Нет keywords. Запусти "1️⃣ Seeds" → "2️⃣ Google Ads".
                </td></tr>
              )}
              {keywords.map(k => (
                <tr key={k._id} onClick={() => setSelected(k)}
                  className="border-t border-white/5 hover:bg-blue-500/5 cursor-pointer">
                  <td className="px-3 py-2 font-medium">{k.keyword}</td>
                  <td className="px-3 py-2 text-slate-400">{k.category} {k.city && `· ${k.city}`}</td>
                  <td className="px-3 py-2 text-right">{k.avgMonthlySearches?.toLocaleString() || '—'}</td>
                  <td className="px-3 py-2 text-right">{k.serpDifficulty || '—'}</td>
                  <td className="px-3 py-2 text-right">{k.competitionIndex || '—'}</td>
                  <td className="px-3 py-2 text-right">{k.bidLow ? `${k.bidLow.toFixed(2)}-${k.bidHigh.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-blue-300">{k.opportunityScore?.toFixed(1) || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 text-[10px]">{k.sources?.join(', ')}</td>
                  <td className="px-3 py-2 text-emerald-400">{k.gscOurPosition ? `pos ${k.gscOurPosition.toFixed(1)}` : '—'}</td>
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
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-3xl w-full max-h-[80vh] overflow-auto p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-xl font-semibold">{selected.keyword}</h2>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white">×</button>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Stat label="Volume / mo" value={selected.avgMonthlySearches?.toLocaleString() || '—'} />
              <Stat label="Difficulty" value={selected.serpDifficulty?.toString() || '—'} />
              <Stat label="Score" value={selected.opportunityScore?.toFixed(1) || '—'} highlight />
            </div>
            {selected.serpTop10 && selected.serpTop10.length > 0 && (
              <>
                <h4 className="text-sm font-semibold text-slate-300 mt-4 mb-2">SERP Top 10</h4>
                <div className="space-y-1">
                  {selected.serpTop10.map(s => (
                    <a key={s.position} href={s.url} target="_blank" rel="noopener"
                      className="block rounded-lg bg-slate-800/40 hover:bg-slate-800/60 p-2 text-sm">
                      <span className="text-slate-500 mr-2">{s.position}.</span>
                      <span className="text-blue-300">{s.domain}</span>
                      <div className="text-xs text-slate-400 mt-0.5">{s.title}</div>
                    </a>
                  ))}
                </div>
              </>
            )}
            {selected.gscOurPosition && (
              <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-600/40 text-sm">
                <b>GSC:</b> ранжируемся на позиции {selected.gscOurPosition.toFixed(1)} —{' '}
                {selected.gscOurImpressions?.toLocaleString()} impressions
              </div>
            )}
            <div className="mt-4">
              <TrainingFeedbackPanel
                kind="keyword-feedback"
                subject={{ keywordId: selected._id, category: selected.category, city: selected.city }}
                originalData={{
                  keyword: selected.keyword,
                  volume: selected.avgMonthlySearches,
                  difficulty: selected.serpDifficulty,
                  score: selected.opportunityScore,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* INFO */}
      <section className="rounded-2xl border border-slate-700 bg-slate-800/30 p-5 text-sm text-slate-400">
        <h3 className="font-semibold text-slate-200 mb-2">📡 Workflow и связь с BBITE</h3>
        <ol className="list-decimal list-inside space-y-1">
          <li><b>1️⃣ Seeds</b> — генерит ~10-15K запросов из providers (category × city × modifiers)</li>
          <li><b>2️⃣ Google Ads</b> — pull volume + competition (бесплатно, нужен developer token)</li>
          <li><b>3️⃣ DataForSEO</b> — SERP top-10 + difficulty (~$0.0006/key, только для volume &gt; 50)</li>
          <li><b>4️⃣ GSC</b> — данные о собственных позициях (для re-scoring)</li>
        </ol>
        <div className="mt-3 p-3 rounded bg-slate-900/40 text-xs">
          <b>BBITE интеграция:</b> <code className="text-blue-300">GET /api/seo/brief?providerId=X</code> возвращает Content Brief
          (mainKeyword, supporting[], SERP competitors, local signals) для генерации /experte/{`{slug}`} страниц.
          BBITE присылает обратно через <code className="text-emerald-300">POST /api/seo/feedback</code> когда GSC видит rank.
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'border-blue-500/40 bg-blue-500/10' : 'border-slate-700 bg-slate-800/40'}`}>
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${highlight ? 'text-blue-300' : ''}`}>{value}</div>
    </div>
  );
}
