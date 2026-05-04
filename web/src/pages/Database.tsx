import { useEffect, useState } from 'react';
import { api } from '../api';
import { FaInstagram, FaFacebook, FaYoutube, FaTiktok, FaTelegram, FaLinkedin, FaXing, FaWhatsapp } from 'react-icons/fa';
import { TrainingFeedbackPanel } from '../components/TrainingFeedbackPanel';

function SocialIcons({ socials }: { socials?: Record<string, string> }) {
  if (!socials) return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const cls = 'w-4 h-4 inline-block transition-transform hover:scale-110';
  return (
    <div className="flex items-center gap-2">
      {socials.instagram && <a href={socials.instagram} target="_blank" rel="noopener" onClick={stop} title="Instagram" className="text-pink-400 hover:text-pink-300"><FaInstagram className={cls} /></a>}
      {socials.facebook && <a href={socials.facebook} target="_blank" rel="noopener" onClick={stop} title="Facebook" className="text-blue-400 hover:text-blue-300"><FaFacebook className={cls} /></a>}
      {socials.youtube && <a href={socials.youtube} target="_blank" rel="noopener" onClick={stop} title="YouTube" className="text-red-400 hover:text-red-300"><FaYoutube className={cls} /></a>}
      {socials.tiktok && <a href={socials.tiktok} target="_blank" rel="noopener" onClick={stop} title="TikTok" className="text-slate-200 hover:text-white"><FaTiktok className={cls} /></a>}
      {socials.telegram && <a href={socials.telegram} target="_blank" rel="noopener" onClick={stop} title="Telegram" className="text-sky-400 hover:text-sky-300"><FaTelegram className={cls} /></a>}
      {socials.linkedin && <a href={socials.linkedin} target="_blank" rel="noopener" onClick={stop} title="LinkedIn" className="text-blue-500 hover:text-blue-400"><FaLinkedin className={cls} /></a>}
      {socials.xing && <a href={socials.xing} target="_blank" rel="noopener" onClick={stop} title="Xing" className="text-emerald-500 hover:text-emerald-400"><FaXing className={cls} /></a>}
      {socials.whatsapp && <a href={socials.whatsapp} target="_blank" rel="noopener" onClick={stop} title="WhatsApp" className="text-green-400 hover:text-green-300"><FaWhatsapp className={cls} /></a>}
    </div>
  );
}

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

  // Bulk selection — manual checkboxes (cap 500). Параллельно с modal-detail `selected`.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<null | {
    kind: 'manual' | 'smart-target';
    targetId?: string;
    count?: number;
    label?: string;
    description?: string;
    sample?: Array<{ _id: string; name?: string; category?: string; city?: string }>;
    pipeline: 'brief-only' | 'full-research';
    submitting?: boolean;
  }>(null);

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 500) next.add(id);
      else alert('Manual selection cap = 500. Для больших — используй smart-target кнопку.');
      return next;
    });
  }
  function selectAllOnPage() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const p of providers) {
        if (next.size >= 500) break;
        next.add(p._id);
      }
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  async function openBulkConfirmManual() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBulkConfirm({ kind: 'manual', count: ids.length, pipeline: 'brief-only' });
    try {
      const r = await api.post('/database/selection/resolve', { kind: 'manual', providerIds: ids });
      setBulkConfirm(b => b ? { ...b, count: r.data.count, sample: r.data.sample } : b);
    } catch (e: any) {
      alert(`Ошибка resolve: ${e.response?.data?.error || e.message}`);
      setBulkConfirm(null);
    }
  }
  async function openBulkConfirmTarget() {
    if (!activeTarget) return;
    setBulkConfirm({ kind: 'smart-target', targetId: activeTarget, pipeline: 'brief-only' });
    try {
      const r = await api.post('/database/selection/resolve', { kind: 'smart-target', targetId: activeTarget });
      setBulkConfirm(b => b ? { ...b, count: r.data.count, label: r.data.label, description: r.data.description, sample: r.data.sample } : b);
    } catch (e: any) {
      alert(`Ошибка resolve: ${e.response?.data?.error || e.message}`);
      setBulkConfirm(null);
    }
  }
  async function submitBulkJob() {
    if (!bulkConfirm || bulkConfirm.submitting) return;
    setBulkConfirm(b => b ? { ...b, submitting: true } : b);
    try {
      const selection = bulkConfirm.kind === 'manual'
        ? { kind: 'manual', providerIds: Array.from(selectedIds) }
        : { kind: 'smart-target', targetId: bulkConfirm.targetId };
      const r = await api.post('/seo-jobs', {
        selection,
        pipeline: bulkConfirm.pipeline,
        label: bulkConfirm.label || (bulkConfirm.kind === 'manual'
          ? `Manual ${selectedIds.size} провайдеров`
          : `Target: ${bulkConfirm.targetId}`),
      });
      alert(`Job создан: ${r.data.jobId}\nTotal: ${r.data.total}\nProxy: ${r.data.useProxy ? 'IPRoyal' : 'нет'}\n\nСмотри прогресс на странице /seo`);
      setBulkConfirm(null);
      if (bulkConfirm.kind === 'manual') clearSelection();
    } catch (e: any) {
      alert(`Ошибка: ${e.response?.data?.error || e.message}`);
      setBulkConfirm(b => b ? { ...b, submitting: false } : b);
    }
  }

  // SEO brief в provider modal — теперь грузим /full (brief + cluster + training)
  const [brief, setBrief] = useState<any | null>(null);
  const [keywordCluster, setKeywordCluster] = useState<any[]>([]);
  const [candidateKeywords, setCandidateKeywords] = useState<any[]>([]);
  const [candidateVotes, setCandidateVotes] = useState<Record<string, 'up' | 'down'>>({});
  const [trainingRecords, setTrainingRecords] = useState<any[]>([]);
  const [handwerkServices, setHandwerkServices] = useState<any | null>(null);
  const [semanticClusters, setSemanticClusters] = useState<any[]>([]);
  const [briefLoading, setBriefLoading] = useState(false);

  async function loadBrief(providerId: string) {
    setBriefLoading(true);
    setBrief(null); setKeywordCluster([]); setTrainingRecords([]); setCandidateKeywords([]); setCandidateVotes({}); setHandwerkServices(null); setSemanticClusters([]);
    try {
      const r = await api.get(`/seo/provider/${providerId}/full`);
      setBrief(r.data.brief);
      setKeywordCluster(r.data.keywordCluster || []);
      setCandidateKeywords(r.data.candidateKeywords || []);
      setTrainingRecords(r.data.trainingRecords || []);
      setHandwerkServices(r.data.handwerkServices || null);
      setSemanticClusters(r.data.clusters || []);
    } catch (e: any) {
      alert('Brief недоступен. Сначала запусти SEO pipeline (Seeds → autocomplete → estimate-volume).');
    } finally { setBriefLoading(false); }
  }
  async function voteCandidate(c: any, vote: 'up' | 'down') {
    if (!brief) return;
    setCandidateVotes(prev => ({ ...prev, [c.text]: vote }));
    try {
      await api.post('/seo/training/feedback', {
        kind: 'keyword-feedback',
        providerId: brief.providerId,
        category: brief.category,
        city: brief.city,
        originalData: { keyword: c.text, source: c.source, weight: c.weight },
        userComment: vote === 'up' ? `Кандидат "${c.text}" из ${c.source} — годится для категории ${brief.category}` : `Кандидат "${c.text}" — мусор, не использовать`,
        rating: vote === 'up' ? 2 : -2,
      });
    } catch (e: any) {
      setCandidateVotes(prev => { const n = { ...prev }; delete n[c.text]; return n; });
      alert(`Ошибка: ${e.response?.data?.error || e.message}`);
    }
  }

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
            <div className="flex items-center gap-2">
              <button onClick={openBulkConfirmTarget}
                className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium">
                🎯 Run SEO research на всю выборку ({total.toLocaleString()})
              </button>
              <button onClick={clearTarget} className="text-xs text-slate-400 hover:text-white">× сбросить</button>
            </div>
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
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={providers.length > 0 && providers.every(p => selectedIds.has(p._id))}
                    onChange={e => {
                      if (e.target.checked) selectAllOnPage();
                      else setSelectedIds(prev => {
                        const next = new Set(prev);
                        for (const p of providers) next.delete(p._id);
                        return next;
                      });
                    }}
                    title="Выбрать всех на этой странице"
                  />
                </th>
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
                  className={`border-t border-slate-700/30 hover:bg-blue-500/5 ${selectedIds.has(p._id) ? 'bg-blue-500/10' : ''}`}>
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p._id)}
                      onChange={() => toggleSelect(p._id)}
                      onClick={e => e.stopPropagation()}
                    />
                  </td>
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
                  <td className="px-3 py-2"><SocialIcons socials={p.socials} /></td>
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

              {/* SEO BRIEF SECTION */}
              <div className="mt-4 pt-4 border-t border-white/10">
                <button onClick={() => loadBrief(selected._id)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-sm font-medium">
                  🎯 SEO Brief / семантика для этого провайдера
                </button>
                {briefLoading && <div className="mt-3 text-slate-400 text-sm">Готовлю brief... (если HWK не cached — fetch ~2-5s)</div>}
                {brief && (
                  <div className="mt-3 space-y-3">
                    {/* HWK GEWERKE — юридически зарегистрированные виды услуг */}
                    {handwerkServices && (
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-xs uppercase text-emerald-300 font-semibold">📋 Виды услуг (HWK Kammer)</span>
                          <span className="text-[10px] text-slate-500">
                            {handwerkServices.source === 'hwk-odav' && '✓ из Handwerksrolle'}
                            {handwerkServices.source === 'hwk-other' && '⚠ структура не распознана'}
                            {handwerkServices.source === 'hwk-failed' && '❌ HWK fetch не удался'}
                            {handwerkServices.scannedAt && ` · ${new Date(handwerkServices.scannedAt).toLocaleDateString('ru')}`}
                          </span>
                        </div>
                        {handwerkServices.items?.length > 0 ? (
                          <>
                            <div className="flex flex-wrap gap-1.5 mb-1">
                              {handwerkServices.items.map((g: string) => (
                                <span key={g} className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-200 text-sm border border-emerald-500/40 font-medium">
                                  {g}
                                </span>
                              ))}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1.5">
                              Это primary SEO seed — ключевая роль для (вид услуг × город). Используется в keyword research и прокидывается в Director.
                            </div>
                            {handwerkServices.rawTitle && (
                              <div className="text-[10px] text-slate-500 mt-1">HWK Betrieb: {handwerkServices.rawTitle}</div>
                            )}
                          </>
                        ) : (
                          <div className="text-xs text-amber-300">
                            Gewerke не распознаны на HWK странице. Возможно нестандартная структура — проверь вручную: <a href={handwerkServices.sourceUrl} target="_blank" className="text-blue-300 underline">{handwerkServices.sourceUrl}</a>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
                      <div className="text-xs uppercase text-purple-300 mb-2">🎯 Main Keyword</div>
                      {brief.mainKeyword ? (
                        <>
                          <div className="font-mono text-base">{brief.mainKeyword.keyword}</div>
                          <div className="text-xs text-slate-400 mt-1">
                            volume: {brief.mainKeyword.volume?.toLocaleString() || '—'} ·
                            difficulty: {brief.mainKeyword.difficulty || '—'} ·
                            score: <b className="text-purple-300">{brief.mainKeyword.score?.toFixed(1)}</b>
                          </div>
                        </>
                      ) : <div className="text-xs text-amber-300">Нет global keywords для (категория, город) — pipeline ещё не прогнал autocomplete для этой пары. Ниже кандидаты из данных провайдера.</div>}
                    </div>

                    {/* CANDIDATE KEYWORDS — извлечены из websiteText/socialContent/youtubeAbout/videos */}
                    {candidateKeywords.length > 0 && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-xs uppercase text-amber-300">🔍 Кандидаты из данных провайдера ({candidateKeywords.length})</span>
                          <span className="text-[10px] text-slate-500">отметь годные/мусор → Director учится</span>
                        </div>
                        <div className="space-y-1">
                          {candidateKeywords.map((c: any) => {
                            const vote = candidateVotes[c.text];
                            return (
                              <div key={c.text} className={`flex items-center gap-2 px-2 py-1.5 rounded transition ${
                                vote === 'up' ? 'bg-emerald-500/15 border border-emerald-500/30' :
                                vote === 'down' ? 'bg-red-500/10 border border-red-500/30 opacity-50' :
                                'bg-slate-900/40 border border-white/5 hover:bg-slate-900/60'
                              }`}>
                                <span className="font-mono text-sm flex-1 truncate" title={c.text}>{c.text}</span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-700/40 text-slate-400 shrink-0">{c.source}</span>
                                <span className="text-[10px] text-slate-500 w-10 text-right shrink-0">w {c.weight.toFixed(0)}</span>
                                <button
                                  onClick={() => voteCandidate(c, 'up')}
                                  disabled={!!vote}
                                  className={`text-xs px-2 py-0.5 rounded transition disabled:cursor-default ${
                                    vote === 'up' ? 'bg-emerald-600 text-white' : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40'
                                  }`}
                                  title="Это годится — добавить в обучение Director'а с rating +2">
                                  ✓ годится
                                </button>
                                <button
                                  onClick={() => voteCandidate(c, 'down')}
                                  disabled={!!vote}
                                  className={`text-xs px-2 py-0.5 rounded transition disabled:cursor-default ${
                                    vote === 'down' ? 'bg-red-600 text-white' : 'bg-red-500/20 text-red-300 hover:bg-red-500/40'
                                  }`}
                                  title="Мусор — отметить с rating -2 чтобы Director не предлагал такое">
                                  ✗ мусор
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {brief.supportingKeywords?.length > 0 && (
                      <div>
                        <div className="text-xs uppercase text-slate-400 mb-2">Supporting Keywords</div>
                        <div className="flex flex-wrap gap-1">
                          {brief.supportingKeywords.map((k: any) => (
                            <span key={k.keyword} className="px-2 py-1 rounded bg-blue-500/10 text-blue-300 text-xs border border-blue-500/30">
                              {k.keyword} <span className="text-slate-500">({k.volume?.toLocaleString() || '0'})</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {brief.serpCompetitors?.length > 0 && (
                      <div>
                        <div className="text-xs uppercase text-slate-400 mb-2">SERP Competitors (top-5)</div>
                        <div className="space-y-1">
                          {brief.serpCompetitors.map((c: any) => (
                            <a key={c.position} href={c.url} target="_blank" rel="noopener"
                              className="block rounded bg-slate-900/40 hover:bg-slate-900/60 p-2 text-xs">
                              <span className="text-slate-500 mr-2">{c.position}.</span>
                              <span className="text-blue-300">{c.domain}</span>
                              <div className="text-slate-400 mt-0.5">{c.title}</div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                      <div className="text-xs uppercase text-emerald-300 mb-2">💡 Local signals</div>
                      <div className="text-xs space-y-0.5">
                        <div>City: {brief.localSignals?.city}</div>
                        <div>PLZ: {brief.localSignals?.plz || '—'}</div>
                        {brief.localSignals?.hwkChamber && (
                          <div>HWK chamber: <a href={brief.localSignals.hwkChamber} target="_blank" className="text-blue-300 hover:underline">{brief.localSignals.hwkChamber}</a></div>
                        )}
                        <div>Verified Handwerker: {brief.localSignals?.registeredHandwerker ? '✓' : '✗'}</div>
                      </div>
                    </div>

                    {brief.recommendations?.length > 0 && (
                      <div>
                        <div className="text-xs uppercase text-slate-400 mb-2">Audit recommendations (что предложить продавать)</div>
                        <div className="flex flex-wrap gap-1">
                          {brief.recommendations.map((rr: string) => (
                            <span key={rr} className="px-2 py-1 rounded bg-amber-500/10 text-amber-300 text-xs border border-amber-500/30">{rr}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Director training feedback */}
                    <TrainingFeedbackPanel
                      kind="brief-edit"
                      subject={{ providerId: brief.providerId, category: brief.category, city: brief.city }}
                      originalData={brief}
                      onSaved={() => loadBrief(brief.providerId)}
                    />

                    {/* SEMANTIC CLUSTERS — group similar keywords by embedding */}
                    {semanticClusters.length > 0 && (
                      <div>
                        <div className="text-xs uppercase text-purple-300 mb-2">
                          📦 Семантические кластеры ({semanticClusters.length}) — для BBITE Site Factory
                        </div>
                        <div className="space-y-2">
                          {semanticClusters.map((c: any) => {
                            const r = c.llmReview;
                            const effPageType = r?.refinedPageType || c.pageType;
                            const displayName = r?.suggestedName || c.clusterName;
                            return (
                            <div key={c._id} className={`rounded-lg border p-3 ${
                              r?.flags?.length > 0 ? 'border-amber-500/40 bg-amber-500/5' :
                              r?.qualityScore !== undefined && r.qualityScore < 5 ? 'border-red-500/30 bg-red-500/5' :
                              'border-purple-500/30 bg-purple-500/5'
                            }`}>
                              <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                  effPageType === 'pricing' ? 'bg-emerald-500/20 text-emerald-300' :
                                  effPageType === 'faq' ? 'bg-amber-500/20 text-amber-300' :
                                  effPageType === 'job-page' ? 'bg-slate-500/20 text-slate-300' :
                                  effPageType === 'general' ? 'bg-slate-500/20 text-slate-400' :
                                  'bg-blue-500/20 text-blue-300'
                                }`}>
                                  {effPageType}
                                </span>
                                <span className="font-semibold text-sm">{displayName}</span>
                                {r?.qualityScore !== undefined && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    r.qualityScore >= 7 ? 'bg-emerald-500/20 text-emerald-300' :
                                    r.qualityScore >= 4 ? 'bg-amber-500/20 text-amber-300' :
                                    'bg-red-500/20 text-red-300'
                                  }`} title={`AI quality score`}>
                                    🤖 {r.qualityScore}/10
                                  </span>
                                )}
                                {r?.flags?.map((f: string) => (
                                  <span key={f} className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300">
                                    ⚠ {f}
                                  </span>
                                ))}
                                <span className="text-[10px] text-slate-500 ml-auto">
                                  {c.size} kw · vol {c.volumeTotal?.toLocaleString()}
                                </span>
                              </div>
                              {r?.notes && (
                                <div className="text-[11px] text-slate-300 italic mb-2">💬 {r.notes}</div>
                              )}
                              {c.supportingKeywords?.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {c.supportingKeywords.slice(0, 12).map((s: any) => (
                                    <span key={s.keyword} className="text-[11px] bg-slate-700/30 hover:bg-slate-700/50 rounded px-1.5 py-0.5">
                                      <span className="text-slate-300">{s.keyword}</span>
                                      <span className="text-slate-500 ml-1">{Math.round((s.similarity || 0) * 100)}%</span>
                                    </span>
                                  ))}
                                  {c.supportingKeywords.length > 12 && (
                                    <span className="text-[10px] text-slate-500 px-1.5">+{c.supportingKeywords.length - 12}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Keyword cluster — top-50 для (category, city) */}
                    {keywordCluster.length > 0 && (
                      <div>
                        <div className="text-xs uppercase text-slate-400 mb-2">
                          Keyword cluster — top {keywordCluster.length} для {brief.category} / {brief.city}
                        </div>
                        <div className="rounded-lg border border-white/10 bg-slate-900/40 max-h-64 overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-900/80 sticky top-0">
                              <tr className="text-left text-slate-400">
                                <th className="px-2 py-1.5">Keyword</th>
                                <th className="px-2 py-1.5 text-right">Vol</th>
                                <th className="px-2 py-1.5 text-right">Diff</th>
                                <th className="px-2 py-1.5 text-right">Score</th>
                                <th className="px-2 py-1.5 text-emerald-400">GSC</th>
                              </tr>
                            </thead>
                            <tbody>
                              {keywordCluster.map((k: any) => (
                                <tr key={k._id} className="border-t border-white/5 hover:bg-blue-500/5">
                                  <td className="px-2 py-1.5 font-medium">{k.keyword}</td>
                                  <td className="px-2 py-1.5 text-right">{k.volume?.toLocaleString() || '—'}</td>
                                  <td className="px-2 py-1.5 text-right">{k.difficulty || '—'}</td>
                                  <td className="px-2 py-1.5 text-right text-blue-300 font-semibold">{k.score?.toFixed(1) || '—'}</td>
                                  <td className="px-2 py-1.5 text-emerald-400">{k.gscPosition ? `pos ${k.gscPosition.toFixed(1)}` : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Training history — что юзер уже правил для этого провайдера */}
                    {trainingRecords.length > 0 && (
                      <div>
                        <div className="text-xs uppercase text-slate-400 mb-2">
                          🤖 Training history — {trainingRecords.length} feedback записей
                        </div>
                        <div className="space-y-1.5">
                          {trainingRecords.map((t: any) => (
                            <div key={t._id} className="rounded bg-slate-900/40 border border-white/5 p-2 text-xs">
                              <div className="flex items-baseline gap-2">
                                <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px]">{t.kind}</span>
                                <span className={`text-[10px] ${
                                  t.rating > 0 ? 'text-emerald-400' : t.rating < 0 ? 'text-red-400' : 'text-slate-500'
                                }`}>
                                  {t.rating > 0 ? `+${t.rating}` : t.rating}
                                </span>
                                <span className="text-slate-500 ml-auto">{new Date(t.createdAt).toLocaleString('ru')}</span>
                              </div>
                              {t.userComment && <div className="mt-1 text-slate-300">{t.userComment}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}


                    <details className="text-xs">
                      <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Raw brief JSON (для BBITE)</summary>
                      <pre className="mt-2 p-2 bg-slate-900/60 rounded overflow-x-auto">{JSON.stringify(brief, null, 2)}</pre>
                    </details>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STICKY BULK TOOLBAR — появляется при manual-выборке через чекбоксы */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border border-blue-500/40 bg-slate-900/95 backdrop-blur-xl px-5 py-3 shadow-2xl shadow-blue-500/30">
          <span className="text-sm">
            Выбрано: <b className="text-blue-300">{selectedIds.size}</b>
            {selectedIds.size >= 500 && <span className="text-amber-400 ml-2 text-xs">(max 500)</span>}
          </span>
          <button onClick={openBulkConfirmManual}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium">
            🎯 Run SEO research
          </button>
          <button onClick={clearSelection} className="text-xs text-slate-400 hover:text-white">× очистить</button>
        </div>
      )}

      {/* BULK CONFIRM MODAL */}
      {bulkConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={() => !bulkConfirm.submitting && setBulkConfirm(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-lg w-full p-6"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-3">Bulk SEO Research</h2>
            <div className="space-y-2 text-sm text-slate-300">
              {bulkConfirm.kind === 'smart-target' ? (
                <>
                  <div><b>Smart-target:</b> {bulkConfirm.label || bulkConfirm.targetId}</div>
                  {bulkConfirm.description && <div className="text-xs text-slate-400">{bulkConfirm.description}</div>}
                </>
              ) : (
                <div><b>Manual selection</b></div>
              )}
              <div><b>Провайдеров:</b> {bulkConfirm.count?.toLocaleString() ?? '...'}</div>
              {bulkConfirm.count && bulkConfirm.count > 1000 && (
                <div className="text-xs text-amber-400">⚡ &gt;1000 → автоматически IPRoyal proxy для autocomplete</div>
              )}
              <div className="mt-3">
                <label className="text-xs text-slate-400">Pipeline:</label>
                <div className="flex gap-2 mt-1">
                  {(['brief-only', 'full-research'] as const).map(p => (
                    <button key={p}
                      onClick={() => setBulkConfirm(b => b ? { ...b, pipeline: p } : b)}
                      className={`px-3 py-1.5 rounded text-xs ${
                        bulkConfirm.pipeline === p
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700/60'
                      }`}>
                      {p === 'brief-only' ? 'Brief only (быстро, только чтение)' : 'Full research (autocomplete + brief)'}
                    </button>
                  ))}
                </div>
              </div>
              {bulkConfirm.sample && bulkConfirm.sample.length > 0 && (
                <div className="mt-3 text-xs">
                  <div className="text-slate-400 mb-1">Sample (первые 5):</div>
                  <ul className="space-y-0.5 text-slate-300">
                    {bulkConfirm.sample.map(s => (
                      <li key={s._id}>• {s.name} <span className="text-slate-500">— {s.category} / {s.city}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setBulkConfirm(null)} disabled={bulkConfirm.submitting}
                className="px-4 py-2 rounded text-sm text-slate-300 hover:bg-slate-700/40">Отмена</button>
              <button onClick={submitBulkJob} disabled={bulkConfirm.submitting || !bulkConfirm.count}
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
                {bulkConfirm.submitting ? 'Создаю...' : 'Создать job →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
