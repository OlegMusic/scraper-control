import { useEffect, useMemo, useState } from 'react';
import { api, socket, type ScraperInfo, type ActiveRun } from '../api';

export function Dashboard() {
  const [scrapers, setScrapers] = useState<ScraperInfo[]>([]);
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [filter, setFilter] = useState('');
  const [argInputs, setArgInputs] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({}); // runId → lines
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  async function refresh() {
    const [s, a] = await Promise.all([api.get<ScraperInfo[]>('/scrapers'), api.get<ActiveRun[]>('/scrapers/active')]);
    setScrapers(s.data);
    setActive(a.data);
  }

  useEffect(() => {
    refresh();
    const sock = socket();
    sock.on('run:start', (e: any) => {
      setActive(prev => [...prev, { runId: e.runId, scraperFile: e.scraperFile, args: e.args, pid: e.pid, startedAt: new Date().toISOString() }]);
      setSelectedRun(e.runId);
      setLogs(p => ({ ...p, [e.runId]: [] }));
    });
    sock.on('run:end', (e: any) => {
      setActive(prev => prev.filter(r => r.runId !== e.runId));
    });
    sock.on('log', (e: { runId: string; kind: string; chunk: string }) => {
      setLogs(p => {
        const cur = p[e.runId] || [];
        const lines = [...cur, ...e.chunk.split(/\r?\n/).filter(Boolean)];
        return { ...p, [e.runId]: lines.slice(-500) };
      });
    });
    const t = setInterval(refresh, 5000);
    return () => { clearInterval(t); sock.off('run:start'); sock.off('run:end'); sock.off('log'); };
  }, []);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return scrapers;
    return scrapers.filter(s => s.file.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [scrapers, filter]);

  const grouped = useMemo(() => {
    const g: Record<string, ScraperInfo[]> = {};
    for (const s of filtered) (g[s.category] ||= []).push(s);
    return g;
  }, [filtered]);

  const isRunning = (file: string) => active.some(a => a.scraperFile === file);
  const getRunId = (file: string) => active.find(a => a.scraperFile === file)?.runId;

  async function start(file: string) {
    const raw = (argInputs[file] || '').trim();
    const args = raw ? raw.split(/\s+/) : [];
    await api.post('/scrapers/run', { scraperFile: file, args });
    await refresh();
  }
  async function stop(file: string) {
    const runId = getRunId(file);
    if (!runId) return;
    await api.post(`/scrapers/stop/${runId}`);
    await refresh();
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Левая колонка — список скраперов */}
      <div className="col-span-7">
        <div className="flex items-center gap-3 mb-4">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Фильтр по имени или описанию..."
            className="flex-1 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700 focus:border-blue-500 outline-none"
          />
          <span className="text-sm text-slate-400">{filtered.length} скриптов</span>
        </div>

        {Object.entries(grouped).map(([cat, items]) => (
          <section key={cat} className="mb-6">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">{cat}</h3>
            <div className="space-y-2">
              {items.map(s => {
                const running = isRunning(s.file);
                return (
                  <div key={s.file} className={`rounded-lg border p-3 transition ${running ? 'border-blue-500/50 bg-blue-500/5' : 'border-slate-700/50 bg-slate-800/40'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-sm text-blue-300">{s.file}</div>
                        {s.description && <div className="text-sm text-slate-400 mt-1">{s.description}</div>}
                        {s.argHints.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {s.argHints.map(a => (
                              <code key={a} className="text-xs px-2 py-0.5 rounded bg-slate-700/40 text-slate-300">{a}</code>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0 items-end">
                        <input
                          value={argInputs[s.file] || ''}
                          onChange={e => setArgInputs(p => ({ ...p, [s.file]: e.target.value }))}
                          placeholder="--city Berlin --plz 10115"
                          className="w-64 px-2 py-1 text-xs rounded bg-slate-900/60 border border-slate-700 font-mono"
                          disabled={running}
                        />
                        {running ? (
                          <button onClick={() => stop(s.file)} className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-sm">Stop</button>
                        ) : (
                          <button onClick={() => start(s.file)} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-sm">Start</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Правая колонка — активные runs + логи */}
      <div className="col-span-5">
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Активные ({active.length})</h3>
        <div className="space-y-2 mb-4">
          {active.length === 0 && <div className="text-sm text-slate-500">Нет запущенных процессов</div>}
          {active.map(a => (
            <button
              key={a.runId}
              onClick={() => setSelectedRun(a.runId)}
              className={`w-full text-left rounded-lg border p-2 ${selectedRun === a.runId ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800/40'}`}
            >
              <div className="font-mono text-xs text-blue-300">{a.scraperFile}</div>
              <div className="text-xs text-slate-400 truncate">PID {a.pid} · args: {a.args.join(' ') || '(none)'}</div>
            </button>
          ))}
        </div>

        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Лог {selectedRun ? `(${selectedRun.slice(-6)})` : ''}</h3>
        <pre className="rounded-lg bg-black/60 border border-slate-700 p-3 h-[600px] overflow-auto text-xs font-mono whitespace-pre-wrap">
          {selectedRun && (logs[selectedRun] || []).join('\n')}
          {!selectedRun && <span className="text-slate-500">Выбери активный процесс слева, чтобы увидеть live-логи</span>}
        </pre>
      </div>
    </div>
  );
}
