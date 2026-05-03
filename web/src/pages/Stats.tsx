import { useEffect, useState } from 'react';
import { api } from '../api';

interface Provider {
  _id: string;
  name: string;
  phone?: string;
  email?: string[];
  website?: string;
  socials?: Record<string, string>;
  city?: string;
  category?: string;
  externalSources?: string[];
  audit?: { overallNeed?: string; websiteScore?: number };
}

interface Overview {
  total: number;
  withPhone: number;
  withEmail: number;
  withWebsite: number;
  withSocials: number;
  withRadarMeta: number;
  withHwk: number;
}

interface SourceRow { _id: string; n: number; }

interface SliceDef {
  targetId: string;             // smart-target ID (на backend)
  label: string;
  metric: keyof Overview | 'enrich-need-website' | 'enrich-need-email' | 'enrich-need-socials' | 'enrich-hwk-no-email';
  color: 'blue' | 'emerald' | 'purple' | 'amber' | 'rose' | 'slate';
}

const SLICES: SliceDef[] = [
  { targetId: 'all',             label: 'Total providers', metric: 'total', color: 'slate' },
  { targetId: 'with-phone',      label: 'С телефоном', metric: 'withPhone', color: 'blue' },
  { targetId: 'with-email',      label: 'С email', metric: 'withEmail', color: 'emerald' },
  { targetId: 'with-website',    label: 'С сайтом', metric: 'withWebsite', color: 'purple' },
  { targetId: 'with-socials',    label: 'С соцсетями', metric: 'withSocials', color: 'amber' },
  { targetId: 'with-radar-meta', label: 'С radarMeta', metric: 'withRadarMeta', color: 'rose' },
  { targetId: 'with-hwk-url',    label: 'С HWK URL', metric: 'withHwk', color: 'rose' },
];

const ENRICH_SLICES: SliceDef[] = [
  { targetId: 'need-email',         label: 'Сайт без email', metric: 'enrich-need-website', color: 'amber' },
  { targetId: 'need-website',       label: 'Без сайта (с phone)', metric: 'enrich-need-email', color: 'amber' },
  { targetId: 'need-socials',       label: 'Сайт без соцсетей', metric: 'enrich-need-socials', color: 'amber' },
  { targetId: 'has-radar-no-email', label: 'HWK без email', metric: 'enrich-hwk-no-email', color: 'amber' },
];

const COLORS: Record<string, string> = {
  blue:    'from-blue-500/30 to-blue-500/5 border-blue-400/30 hover:from-blue-500/45',
  emerald: 'from-emerald-500/30 to-emerald-500/5 border-emerald-400/30 hover:from-emerald-500/45',
  purple:  'from-purple-500/30 to-purple-500/5 border-purple-400/30 hover:from-purple-500/45',
  amber:   'from-amber-500/30 to-amber-500/5 border-amber-400/30 hover:from-amber-500/45',
  rose:    'from-rose-500/30 to-rose-500/5 border-rose-400/30 hover:from-rose-500/45',
  slate:   'from-slate-500/20 to-slate-500/5 border-slate-400/20 hover:from-slate-500/35',
};

export function Stats() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [cities, setCities] = useState<SourceRow[]>([]);
  const [gaps, setGaps] = useState<any>(null);

  // Drill-down state
  const [drillSlice, setDrillSlice] = useState<SliceDef | null>(null);
  const [drillItems, setDrillItems] = useState<Provider[]>([]);
  const [drillTotal, setDrillTotal] = useState(0);
  const [drillSkip, setDrillSkip] = useState(0);
  const [drillLoading, setDrillLoading] = useState(false);
  const limit = 25;

  useEffect(() => {
    (async () => {
      const [o, s, c, g] = await Promise.all([
        api.get<Overview>('/stats/overview'),
        api.get<SourceRow[]>('/stats/by-source'),
        api.get<SourceRow[]>('/stats/by-city'),
        api.get<any>('/stats/gaps'),
      ]);
      setOverview(o.data); setSources(s.data); setCities(c.data); setGaps(g.data);
    })();
  }, []);

  // Custom drill через /database/providers (поддерживает простые city/source фильтры)
  async function openDrillCustom(label: string, queryParams: Record<string, string>) {
    setDrillSlice({ targetId: '_custom', label, metric: 'total', color: 'blue' });
    setDrillSkip(0);
    setDrillLoading(true);
    setDrillItems([]);
    try {
      const params: any = { limit, skip: 0 };
      if (queryParams.city) params.city = queryParams.city;
      if (queryParams.externalSources) params.source = queryParams.externalSources;
      const r = await api.get<{ items: Provider[]; total: number }>('/database/providers', { params });
      setDrillItems(r.data.items);
      setDrillTotal(r.data.total);
    } catch (e: any) {
      console.warn('drill custom failed', e.message);
    } finally { setDrillLoading(false); }
  }

  async function openDrill(slice: SliceDef, skip = 0) {
    setDrillSlice(slice);
    setDrillSkip(skip);
    setDrillLoading(true);
    setDrillItems([]);
    try {
      const r = await api.get<{ items: Provider[]; total: number }>(`/database/smart-targets/${slice.targetId}`, {
        params: { limit, skip },
      });
      setDrillItems(r.data.items);
      setDrillTotal(r.data.total);
    } catch (e: any) {
      console.warn('drill failed', e.message);
    } finally { setDrillLoading(false); }
  }

  if (!overview) return <div className="text-slate-400">Загрузка...</div>;
  const get = (key: SliceDef['metric']) => {
    if (key.startsWith('enrich-')) {
      if (!gaps) return 0;
      return key === 'enrich-need-website' ? gaps.websiteNoEmail
        : key === 'enrich-need-email' ? gaps.phoneNoEmail
        : key === 'enrich-need-socials' ? gaps.websiteNoSocials
        : key === 'enrich-hwk-no-email' ? gaps.hwkNoEmail
        : 0;
    }
    return overview[key as keyof Overview] as number;
  };
  const pct = (v: number) => overview.total ? `${(100 * v / overview.total).toFixed(1)}%` : '0%';

  return (
    <div className="space-y-6">
      {/* Main slices */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-3">Покрытие</h3>
        <div className="grid grid-cols-4 gap-3">
          {SLICES.map(s => {
            const value = get(s.metric);
            return (
              <button key={s.targetId} onClick={() => openDrill(s)}
                className={`text-left rounded-2xl border bg-gradient-to-br ${COLORS[s.color]} p-5 transition-all hover:scale-[1.02] hover:shadow-xl cursor-pointer`}>
                <div className="text-xs uppercase tracking-wider text-slate-300/80">{s.label}</div>
                <div className="text-3xl font-semibold mt-1">{value.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">{s.metric === 'total' ? '100% базы' : pct(value)}</div>
                <div className="mt-3 text-xs text-blue-300/80 group-hover:text-blue-200">→ показать список</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Enrichment candidates */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-3">Кандидаты на enrichment</h3>
        <div className="grid grid-cols-4 gap-3">
          {ENRICH_SLICES.map(s => {
            const value = get(s.metric);
            return (
              <button key={s.targetId} onClick={() => openDrill(s)}
                className={`text-left rounded-2xl border bg-gradient-to-br ${COLORS[s.color]} p-5 transition-all hover:scale-[1.02] hover:shadow-xl cursor-pointer`}>
                <div className="text-xs uppercase tracking-wider text-amber-300/80">{s.label}</div>
                <div className="text-3xl font-semibold mt-1">{value.toLocaleString()}</div>
                <div className="mt-2 text-xs text-blue-300/80">→ список с контактами</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sources & Cities */}
      <div className="grid grid-cols-2 gap-4">
        <section className="rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-md overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h3 className="text-sm font-semibold">Top sources</h3>
          </div>
          <div className="divide-y divide-white/5 max-h-[480px] overflow-auto">
            {sources.slice(0, 30).map(s => (
              <button key={s._id} onClick={() => openDrillCustom(`Source: ${s._id}`, { externalSources: s._id })}
                className="w-full px-4 py-2.5 flex justify-between text-sm hover:bg-white/5 transition text-left">
                <span className="font-mono text-slate-300">{s._id}</span>
                <span className="text-slate-400">{s.n.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-md overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h3 className="text-sm font-semibold">Top cities</h3>
          </div>
          <div className="divide-y divide-white/5 max-h-[480px] overflow-auto">
            {cities.slice(0, 30).map(c => (
              <button key={c._id} onClick={() => openDrillCustom(`Город: ${c._id}`, { city: c._id })}
                className="w-full px-4 py-2.5 flex justify-between text-sm hover:bg-white/5 transition text-left">
                <span className="text-slate-300">{c._id}</span>
                <span className="text-slate-400">{c.n.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Drill-down modal */}
      {drillSlice && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end justify-center p-4 sm:p-6"
          onClick={() => setDrillSlice(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-6xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
              <h2 className="text-lg font-semibold">{drillSlice.label}</h2>
              <span className="text-sm text-slate-400">{drillTotal.toLocaleString()} записей</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => openDrill(drillSlice, Math.max(0, drillSkip - limit))} disabled={drillSkip === 0}
                  className="px-2 py-1 rounded bg-white/5 text-xs disabled:opacity-30">←</button>
                <span className="text-xs text-slate-400">{drillSkip + 1}–{Math.min(drillSkip + limit, drillTotal)}</span>
                <button onClick={() => openDrill(drillSlice, drillSkip + limit)} disabled={drillSkip + limit >= drillTotal}
                  className="px-2 py-1 rounded bg-white/5 text-xs disabled:opacity-30">→</button>
                <button onClick={() => setDrillSlice(null)} className="text-slate-400 hover:text-white ml-2">✕</button>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {drillLoading && <div className="p-8 text-center text-slate-400">Загрузка...</div>}
              {!drillLoading && (
                <table className="w-full text-sm">
                  <thead className="bg-slate-800/60 sticky top-0">
                    <tr className="text-left text-slate-400 text-xs">
                      <th className="px-4 py-2">Имя</th>
                      <th className="px-4 py-2">Город · Категория</th>
                      <th className="px-4 py-2">Контакты</th>
                      <th className="px-4 py-2">Соц</th>
                      <th className="px-4 py-2">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillItems.map(p => (
                      <tr key={p._id} className="border-t border-white/5 hover:bg-white/5">
                        <td className="px-4 py-2.5 font-medium">{p.name?.slice(0, 50)}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">
                          {p.city} · {p.category?.slice(0, 30)}
                        </td>
                        <td className="px-4 py-2.5 text-xs space-x-2">
                          {p.phone && <span title={p.phone}>📞 {p.phone}</span>}
                          {p.email?.[0] && (
                            <a href={`mailto:${p.email[0]}`} className="text-blue-300 hover:underline">
                              ✉ {p.email[0].slice(0, 25)}
                            </a>
                          )}
                          {p.website && (
                            <a href={p.website} target="_blank" className="text-blue-300 hover:underline">
                              🌐 {p.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 25)}
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-base space-x-1">
                          {p.socials?.instagram && <a href={p.socials.instagram} target="_blank" title="Instagram">📷</a>}
                          {p.socials?.facebook && <a href={p.socials.facebook} target="_blank" title="Facebook">📘</a>}
                          {p.socials?.youtube && <a href={p.socials.youtube} target="_blank" title="YouTube">📺</a>}
                          {p.socials?.tiktok && <a href={p.socials.tiktok} target="_blank" title="TikTok">🎵</a>}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {p.audit?.overallNeed && (
                            <span className={`px-2 py-0.5 rounded-full ${
                              p.audit.overallNeed === 'critical' ? 'bg-red-500/20 text-red-300' :
                              p.audit.overallNeed === 'major' ? 'bg-amber-500/20 text-amber-300' :
                              p.audit.overallNeed === 'minor' ? 'bg-yellow-500/20 text-yellow-300' :
                              'bg-emerald-500/20 text-emerald-300'
                            }`}>
                              {p.audit.overallNeed} {p.audit.websiteScore?.toFixed(1)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
