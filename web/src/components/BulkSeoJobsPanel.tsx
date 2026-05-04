import { useEffect, useState } from 'react';
import { api, socket } from '../api';

interface SeoJob {
  _id: string;
  label?: string;
  pipeline: 'brief-only' | 'full-research';
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  total: number;
  progress: { processed: number; succeeded: number; failed: number; skipped: number };
  cursorIndex: number;
  selection: { kind: string; targetId?: string; providerCount?: number };
  rateLimit: { perMinute: number; useProxy: boolean };
  startedAt?: string;
  endedAt?: string;
  heartbeatAt?: string;
  createdAt: string;
  errorCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-500/20 text-slate-300',
  running: 'bg-blue-500/20 text-blue-300',
  paused: 'bg-amber-500/20 text-amber-300',
  completed: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-slate-700/40 text-slate-500',
};

export function BulkSeoJobsPanel() {
  const [jobs, setJobs] = useState<SeoJob[]>([]);
  const [showAll, setShowAll] = useState(false);

  async function refresh() {
    const r = await api.get<{ items: SeoJob[] }>('/seo-jobs', { params: { limit: 30 } });
    setJobs(r.data.items);
  }

  useEffect(() => {
    refresh();
    const s = socket();
    const onProgress = () => refresh();
    const onEnd = () => refresh();
    const onStart = () => refresh();
    s.on('seo:job:progress', onProgress);
    s.on('seo:job:end', onEnd);
    s.on('seo:job:start', onStart);
    const interval = setInterval(refresh, 5000);
    return () => {
      s.off('seo:job:progress', onProgress);
      s.off('seo:job:end', onEnd);
      s.off('seo:job:start', onStart);
      clearInterval(interval);
    };
  }, []);

  async function action(jobId: string, op: 'pause' | 'resume' | 'cancel') {
    try {
      await api.post(`/seo-jobs/${jobId}/${op}`);
      await refresh();
    } catch (e: any) {
      alert(`Ошибка: ${e.response?.data?.error || e.message}`);
    }
  }

  const visible = showAll ? jobs : jobs.filter(j => ['pending', 'running', 'paused'].includes(j.status));
  const activeCount = jobs.filter(j => ['pending', 'running', 'paused'].includes(j.status)).length;

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">📦 Bulk SEO Research Jobs</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-400">
            {activeCount > 0
              ? <span className="text-blue-300">{activeCount} active</span>
              : 'нет активных'}
            {' / '}{jobs.length} total
          </span>
          <button onClick={() => setShowAll(s => !s)} className="text-slate-400 hover:text-white">
            {showAll ? 'только активные' : 'показать всё'}
          </button>
          <button onClick={refresh} className="text-slate-400 hover:text-white">↻</button>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="text-xs text-slate-500 text-center py-4">
          {jobs.length === 0
            ? 'Запусти research через /database → выбери провайдеров → "Run SEO research"'
            : 'Нет активных job\'ов. Кликни "показать всё" для истории.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(j => {
            const pct = j.total > 0 ? Math.min(100, (j.progress.processed / j.total) * 100) : 0;
            return (
              <div key={j._id} className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
                <div className="flex items-baseline gap-3 mb-1.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[j.status] || 'bg-slate-700/40'}`}>
                    {j.status}
                  </span>
                  <span className="text-sm font-medium">{j.label || j._id.slice(-8)}</span>
                  <span className="text-xs text-slate-500">
                    {j.pipeline} · {j.selection.kind}{j.selection.targetId ? ` (${j.selection.targetId})` : ''}
                    {j.rateLimit.useProxy && ' · 🌐 IPRoyal'}
                  </span>
                  <div className="ml-auto flex gap-2">
                    {j.status === 'running' && <button onClick={() => action(j._id, 'pause')} className="text-xs text-amber-300 hover:text-amber-200">⏸ pause</button>}
                    {j.status === 'paused' && <button onClick={() => action(j._id, 'resume')} className="text-xs text-blue-300 hover:text-blue-200">▶ resume</button>}
                    {['pending', 'running', 'paused'].includes(j.status) && (
                      <button onClick={() => action(j._id, 'cancel')} className="text-xs text-red-300 hover:text-red-200">✕ cancel</button>
                    )}
                  </div>
                </div>
                <div className="flex items-baseline gap-3 text-xs text-slate-400 mb-1.5">
                  <span><b className="text-slate-200">{j.progress.processed.toLocaleString()}</b> / {j.total.toLocaleString()}</span>
                  <span>· ✓ {j.progress.succeeded}</span>
                  <span>· — {j.progress.skipped}</span>
                  {j.progress.failed > 0 && <span className="text-red-400">· ✗ {j.progress.failed}</span>}
                  {j.errorCount > 0 && <span className="text-amber-400">· {j.errorCount} errors</span>}
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      j.status === 'running' ? 'bg-blue-500' :
                      j.status === 'completed' ? 'bg-emerald-500' :
                      j.status === 'failed' ? 'bg-red-500' :
                      'bg-slate-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
