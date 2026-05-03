import { useEffect, useState } from 'react';
import { api, type JobRecord, type ScraperInfo } from '../api';

const PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Каждое утро в 06:00', cron: '0 6 * * *' },
  { label: 'Каждый час', cron: '0 * * * *' },
  { label: 'Каждые 30 минут', cron: '*/30 * * * *' },
  { label: 'Понедельник 09:00', cron: '0 9 * * 1' },
  { label: 'Каждый день 22:00', cron: '0 22 * * *' },
];

export function Schedule() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [scrapers, setScrapers] = useState<ScraperInfo[]>([]);
  const [draft, setDraft] = useState({ scraperFile: '', args: '', cron: '0 6 * * *', label: '' });

  async function refresh() {
    const [j, s] = await Promise.all([api.get<JobRecord[]>('/jobs'), api.get<ScraperInfo[]>('/scrapers')]);
    setJobs(j.data);
    setScrapers(s.data);
  }
  useEffect(() => { refresh(); }, []);

  async function create() {
    if (!draft.scraperFile) return;
    const args = draft.args.trim() ? draft.args.trim().split(/\s+/) : [];
    await api.post('/jobs', { scraperFile: draft.scraperFile, args, cron: draft.cron, label: draft.label });
    setDraft({ scraperFile: '', args: '', cron: '0 6 * * *', label: '' });
    await refresh();
  }
  async function toggle(j: JobRecord) {
    await api.put(`/jobs/${j._id}`, { enabled: !j.enabled });
    await refresh();
  }
  async function remove(j: JobRecord) {
    if (!confirm(`Удалить расписание "${j.label || j.scraperFile}"?`)) return;
    await api.delete(`/jobs/${j._id}`);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <h3 className="font-semibold mb-3">Новое расписание</h3>
        <div className="grid grid-cols-12 gap-2">
          <select
            value={draft.scraperFile}
            onChange={e => setDraft(p => ({ ...p, scraperFile: e.target.value }))}
            className="col-span-4 px-3 py-2 rounded bg-slate-900/60 border border-slate-700"
          >
            <option value="">Выбери скрипт...</option>
            {scrapers.map(s => <option key={s.file} value={s.file}>{s.file}</option>)}
          </select>
          <input
            value={draft.args}
            onChange={e => setDraft(p => ({ ...p, args: e.target.value }))}
            placeholder="--city Berlin --plz 10115 --radius 250"
            className="col-span-4 px-3 py-2 rounded bg-slate-900/60 border border-slate-700 font-mono text-sm"
          />
          <input
            value={draft.cron}
            onChange={e => setDraft(p => ({ ...p, cron: e.target.value }))}
            placeholder="0 6 * * *"
            className="col-span-2 px-3 py-2 rounded bg-slate-900/60 border border-slate-700 font-mono text-sm"
          />
          <input
            value={draft.label}
            onChange={e => setDraft(p => ({ ...p, label: e.target.value }))}
            placeholder="Утренний прогон"
            className="col-span-2 px-3 py-2 rounded bg-slate-900/60 border border-slate-700"
          />
        </div>
        <div className="flex gap-2 mt-2 flex-wrap">
          {PRESETS.map(p => (
            <button key={p.cron} onClick={() => setDraft(d => ({ ...d, cron: p.cron }))}
              className="text-xs px-2 py-1 rounded bg-slate-700/40 hover:bg-slate-700/60 text-slate-300">
              {p.label}
            </button>
          ))}
          <button onClick={create} className="ml-auto px-4 py-1 rounded bg-blue-600 hover:bg-blue-700 text-sm">Создать</button>
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Существующие расписания ({jobs.length})</h3>
        <div className="space-y-2">
          {jobs.length === 0 && <div className="text-sm text-slate-500">Расписаний нет</div>}
          {jobs.map(j => (
            <div key={j._id} className={`rounded-lg border p-3 ${j.enabled ? 'border-slate-700 bg-slate-800/40' : 'border-slate-700/30 bg-slate-800/10 opacity-60'}`}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={j.enabled}
                  onChange={() => toggle(j)}
                  className="w-4 h-4"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex gap-2 items-baseline">
                    <span className="font-medium">{j.label || j.scraperFile}</span>
                    <code className="text-xs text-slate-500">{j.cron}</code>
                  </div>
                  <div className="text-xs text-slate-400 font-mono truncate">
                    {j.scraperFile} {j.args.join(' ')}
                  </div>
                </div>
                <button onClick={() => remove(j)} className="text-xs text-red-400 hover:text-red-300">Удалить</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="text-xs text-slate-500">
        <details>
          <summary className="cursor-pointer">Cron синтаксис</summary>
          <pre className="mt-2 p-2 bg-slate-900/60 rounded">
{`* * * * *
│ │ │ │ └ день недели (0-7, 0=вс)
│ │ │ └── месяц (1-12)
│ │ └──── день месяца (1-31)
│ └────── час (0-23)
└──────── минута (0-59)

Примеры:
  0 6 * * *         каждый день в 06:00
  */15 * * * *      каждые 15 минут
  0 9 * * 1-5       будни в 09:00`}
          </pre>
        </details>
      </section>
    </div>
  );
}
