import { useEffect, useState } from 'react';
import { api } from '../api';
import { TrainingFeedbackPanel } from '../components/TrainingFeedbackPanel';

interface Agent {
  id: string;
  name: string;
  emoji: string;
  description: string;
  expertise: string;
  domain: 'seo' | 'scraper';
  systemPromptPreview: string;
  training?: { total: number; positive: number; negative: number };
}

interface GlobalStats {
  trainingRecords: number;
  ratingDistribution: Array<{ rating: number; n: number }>;
  clustersTotal: number;
  clustersLlmReviewed: number;
}

interface TestResponse {
  agent: { id: string; name: string; emoji: string };
  advice: string;
  ragStatus: 'ok' | 'empty' | 'unavailable';
  ragHitsUsed: number;
  ragHits: Array<{ kind: string; rating: number; category?: string; city?: string; userComment: string; score: number }>;
  backend: string;
}

interface TrainingItem {
  _id: string;
  kind: string;
  providerId?: string;
  category?: string;
  city?: string;
  userComment?: string;
  rating?: number;
  createdAt: string;
  embeddingId?: string;
}

const DOMAIN_BADGE: Record<string, string> = {
  seo: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  scraper: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
};

export function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [global, setGlobal] = useState<GlobalStats | null>(null);
  const [recent, setRecent] = useState<TrainingItem[]>([]);
  const [active, setActive] = useState<Agent | null>(null);
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [response, setResponse] = useState<TestResponse | null>(null);
  const [testing, setTesting] = useState(false);

  async function refresh() {
    const [a, s, r] = await Promise.all([
      api.get<Agent[]>('/agents'),
      api.get<{ agents: Agent[]; global: GlobalStats }>('/agents/stats'),
      api.get<{ items: TrainingItem[] }>('/agents/training/recent', { params: { limit: 30 } }),
    ]);
    // merge stats into agent list
    const statsMap = new Map(s.data.agents.map(x => [x.id, x.training]));
    const merged = a.data.map(ag => ({ ...ag, training: statsMap.get(ag.id) }));
    setAgents(merged);
    setGlobal(s.data.global);
    setRecent(r.data.items);
  }

  useEffect(() => { refresh(); }, []);

  async function runTest() {
    if (!active || !question.trim() || testing) return;
    setTesting(true); setResponse(null);
    try {
      const r = await api.post<TestResponse>(`/agents/${active.id}/test`, {
        question: question.trim(),
        context: context.trim() || undefined,
      });
      setResponse(r.data);
    } catch (e: any) {
      alert(`Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 hero-gradient p-6">
        <h1 className="text-2xl font-semibold mb-1">🤖 AI Agents</h1>
        <p className="text-slate-400 text-sm mb-4">
          9 специалистов: SEO (3) и Scraper (6). Каждый с RAG-augmentation от user feedback.
        </p>
        {global && (
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">Training records</div>
              <div className="text-2xl font-semibold mt-1">{global.trainingRecords.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">накоплено в Qdrant</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">Clusters total</div>
              <div className="text-2xl font-semibold mt-1">{global.clustersTotal.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">из них LLM-reviewed: {global.clustersLlmReviewed}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">Rating distribution</div>
              <div className="flex gap-1 mt-1">
                {[-2, -1, 0, 1, 2].map(r => {
                  const found = global.ratingDistribution.find(d => d.rating === r);
                  return (
                    <span key={r} className={`px-1.5 py-0.5 rounded text-[10px] ${
                      r > 0 ? 'bg-emerald-500/20 text-emerald-300' :
                      r < 0 ? 'bg-red-500/20 text-red-300' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>
                      {r > 0 ? `+${r}` : r}: {found?.n || 0}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">Coverage</div>
              <div className="text-2xl font-semibold mt-1">
                {global.clustersTotal > 0 ? Math.round((global.clustersLlmReviewed / global.clustersTotal) * 100) : 0}%
              </div>
              <div className="text-xs text-slate-400 mt-1">cluster ⇒ LLM review</div>
            </div>
          </div>
        )}
      </section>

      {/* AGENT GRID */}
      <section className="grid grid-cols-3 gap-3">
        {agents.map(a => (
          <button key={a.id}
            onClick={() => { setActive(a); setQuestion(''); setContext(''); setResponse(null); }}
            className={`text-left rounded-2xl border p-4 transition ${
              active?.id === a.id ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-slate-900/40 hover:bg-slate-800/50'
            }`}>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl">{a.emoji}</span>
              <span className="font-semibold">{a.name}</span>
              <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] border ${DOMAIN_BADGE[a.domain]}`}>
                {a.domain}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-2">{a.expertise}</div>
            <div className="text-xs text-slate-500 mt-2 line-clamp-2">{a.description}</div>
          </button>
        ))}
      </section>

      {/* TEST + DETAIL */}
      {active && (
        <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">{active.emoji} {active.name}</h2>
            <button onClick={() => { setActive(null); setResponse(null); }} className="ml-auto text-slate-400 hover:text-white text-sm">× закрыть</button>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-slate-400 hover:text-slate-200">System prompt preview</summary>
            <pre className="mt-2 p-2 bg-slate-900/60 rounded whitespace-pre-wrap text-slate-300">{active.systemPromptPreview}…</pre>
          </details>

          {/* Test form */}
          <div className="rounded-lg border border-white/10 bg-slate-900/40 p-3">
            <div className="text-xs uppercase text-slate-400 mb-2">🧪 Test: задать вопрос напрямую</div>
            <input value={question} onChange={e => setQuestion(e.target.value)}
              placeholder='Вопрос (e.g. "Какие keywords выбрать для Friseur Berlin")'
              className="w-full px-3 py-2 rounded bg-slate-800 border border-white/10 text-sm mb-2" />
            <input value={context} onChange={e => setContext(e.target.value)}
              placeholder="Контекст (опц.) — например 'category=Friseur, city=Berlin, gewerke=Friseurmeister'"
              className="w-full px-3 py-2 rounded bg-slate-800 border border-white/10 text-xs mb-2" />
            <button onClick={runTest} disabled={testing || !question.trim()}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
              {testing ? 'Думаю...' : 'Спросить'}
            </button>
          </div>

          {/* Response */}
          {response && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
              <div className="flex items-baseline gap-2 text-xs">
                <span className="text-emerald-300 font-semibold">Ответ</span>
                <span className="text-slate-500">backend: {response.backend}</span>
                <span className={`ml-auto px-2 py-0.5 rounded text-[10px] ${
                  response.ragStatus === 'ok' ? 'bg-emerald-500/20 text-emerald-300' :
                  response.ragStatus === 'empty' ? 'bg-slate-500/20 text-slate-400' :
                  'bg-amber-500/20 text-amber-300'
                }`}>
                  RAG {response.ragStatus} ({response.ragHitsUsed} hits)
                </span>
              </div>
              <div className="text-sm text-slate-200 whitespace-pre-wrap">{response.advice}</div>
              {response.ragHits.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-400">RAG hits used</summary>
                  <div className="mt-2 space-y-1">
                    {response.ragHits.map((h, i) => (
                      <div key={i} className="rounded bg-slate-900/40 p-2">
                        <div className="text-[10px] text-slate-500">
                          {h.kind} · rating {h.rating} · {h.category}/{h.city} · score {h.score?.toFixed(3)}
                        </div>
                        <div className="text-slate-300 mt-0.5">{h.userComment}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {/* Feedback на ответ агента — улучшит RAG через 'agent-output' kind */}
              <TrainingFeedbackPanel
                kind="agent-output"
                subject={{ agentId: active.id }}
                originalData={{ agentId: active.id, question, context, advice: response.advice }}
                placeholder={`Этот ответ ${active.name} хорош/плох потому что...`}
                onSaved={refresh}
              />
            </div>
          )}
        </section>
      )}

      {/* RECENT TRAINING TIMELINE */}
      {recent.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
          <h3 className="font-semibold mb-3">📜 Recent training records ({recent.length})</h3>
          <div className="space-y-1.5">
            {recent.map(t => (
              <div key={t._id} className="rounded bg-slate-900/40 border border-white/5 p-2 text-xs">
                <div className="flex items-baseline gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px]">{t.kind}</span>
                  {typeof t.rating === 'number' && (
                    <span className={`text-[10px] ${
                      t.rating > 0 ? 'text-emerald-400' : t.rating < 0 ? 'text-red-400' : 'text-slate-500'
                    }`}>
                      {t.rating > 0 ? `+${t.rating}` : t.rating}
                    </span>
                  )}
                  {t.category && <span className="text-slate-500">{t.category}</span>}
                  {t.city && <span className="text-slate-500">/ {t.city}</span>}
                  {t.embeddingId && <span className="text-emerald-500 text-[10px]">✓ embedded</span>}
                  <span className="text-slate-500 ml-auto">{new Date(t.createdAt).toLocaleString('ru')}</span>
                </div>
                {t.userComment && <div className="mt-1 text-slate-300 line-clamp-2">{t.userComment}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
