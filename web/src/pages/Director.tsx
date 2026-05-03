import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface ChatMsg { role: 'user' | 'assistant'; content: string; }
interface ToolLogEntry { tool: string; input: any; output: any; }
interface AgentInfo { id: string; name: string; emoji: string; description: string; expertise: string; }
interface AuthStatus {
  apiKey: { configured: boolean };
  claudeCli: { available: boolean; version?: string };
  activeMode: 'api-key' | 'claude-cli' | 'none';
}

const SUGGESTIONS = [
  'Покажи статистику базы и что сейчас работает',
  'Запускай каждое утро в 6:00 на месяц: HWK enricher и YouTube discovery',
  'Запусти scrape-handwerker-radar для Hannover (PLZ 30159) сейчас',
  'Какие города собраны хуже всего?',
  'Каждый понедельник в 09:00 → fast-email-extract на 10000 кандидатов',
  'Останови все активные процессы',
];

export function Director() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolLog, setToolLog] = useState<ToolLogEntry[][]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    api.get<AgentInfo[]>('/director/agents').then(r => setAgents(r.data)).catch(() => {});
    api.get<AuthStatus>('/director/auth-status').then(r => setAuth(r.data)).catch(() => {});
  }, []);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');
    const next: ChatMsg[] = [...messages, { role: 'user', content: msg }];
    setMessages(next);
    setLoading(true);
    try {
      const r = await api.post<{ reply: string; toolLog: ToolLogEntry[] }>('/director/chat', { messages: next });
      setMessages([...next, { role: 'assistant', content: r.data.reply }]);
      setToolLog(prev => [...prev, r.data.toolLog || []]);
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message;
      setMessages([...next, { role: 'assistant', content: `❌ Ошибка: ${errMsg}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearChat() {
    setMessages([]);
    setToolLog([]);
  }

  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)]">
      {/* Left: chat */}
      <div className="col-span-8 flex flex-col rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-700/50 flex items-center gap-3">
          <span className="font-semibold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">AI Director</span>
          {auth && (
            auth.activeMode === 'api-key'
              ? <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">API key · полный режим (tools)</span>
              : auth.activeMode === 'claude-cli'
                ? <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300" title={auth.claudeCli.version}>Claude CLI · text-режим (без tools)</span>
                : <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">Авторизация не настроена</span>
          )}
          <button onClick={clearChat} className="ml-auto text-xs text-slate-400 hover:text-slate-200">Очистить</button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-slate-400 text-sm pt-8">
              {auth?.activeMode === 'none' && (
                <div className="mb-6 mx-auto max-w-md p-4 rounded-lg bg-amber-500/10 border border-amber-600/40 text-left">
                  <div className="font-semibold text-amber-300 mb-2">⚠ Авторизация не настроена</div>
                  <div className="text-amber-100/70 text-xs space-y-1">
                    <div>1) Установи Claude Code CLI и авторизуйся (`claude login`) — рекомендую, без оплаты по токенам</div>
                    <div>2) ИЛИ добавь ANTHROPIC_API_KEY в parser-firecrawl/.env</div>
                    <div>После — перезапусти scraper-control сервер.</div>
                  </div>
                </div>
              )}
              {auth?.activeMode === 'claude-cli' && (
                <div className="mb-4 mx-auto max-w-md p-3 rounded-lg bg-blue-500/5 border border-blue-600/30 text-left">
                  <div className="text-blue-300 text-xs">
                    💡 В bridge-режиме через Claude CLI Director даёт <b>текстовые советы</b>.
                    Для автоматического выполнения (создания cron-jobs, запуска скриптов) — добавь
                    ANTHROPIC_API_KEY (получишь "tools mode").
                  </div>
                </div>
              )}
              <p className="mb-3">Напиши команду на любом языке:</p>
              <div className="flex flex-col gap-2 max-w-lg mx-auto">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="text-left px-3 py-2 rounded-lg bg-slate-700/30 hover:bg-slate-700/50 text-slate-300 text-sm">
                    "{s}"
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                m.role === 'user'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                  : 'bg-slate-700/40 text-slate-100 whitespace-pre-wrap'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-2 bg-slate-700/40 text-slate-300 text-sm">
                <span className="inline-block animate-pulse">Думаю...</span>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-700/50 p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={2}
              placeholder="Например: запускай каждое утро в 6:00 — radar, HWK enricher, YouTube..."
              className="flex-1 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 focus:border-blue-500 outline-none text-sm resize-none"
              disabled={loading}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="px-5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed self-stretch"
            >
              ➤
            </button>
          </div>
          <div className="text-xs text-slate-500 mt-1">Enter для отправки · Shift+Enter новая строка</div>
        </div>
      </div>

      {/* Right: agents + tool log */}
      <div className="col-span-4 flex flex-col gap-3 overflow-hidden">
        {/* Agents */}
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700/50 flex items-center justify-between">
            <span className="font-semibold text-sm">Агенты-консультанты</span>
            <span className="text-xs text-slate-500">{agents.length}</span>
          </div>
          <div className="p-2 space-y-1 max-h-[280px] overflow-auto">
            {agents.map(a => (
              <button key={a.id} onClick={() => send(`Проконсультируйся с ${a.name}: что мне делать прямо сейчас?`)}
                className="w-full text-left rounded p-2 hover:bg-slate-700/40 transition group">
                <div className="flex items-baseline gap-2">
                  <span>{a.emoji}</span>
                  <span className="font-medium text-sm">{a.name}</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5 group-hover:text-slate-300">{a.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Tool log */}
        <div className="flex-1 flex flex-col rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700/50">
            <span className="font-semibold text-sm">Журнал действий</span>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-2 text-xs font-mono">
            {toolLog.length === 0 && <div className="text-slate-500">Ещё нет вызовов</div>}
            {toolLog.flatMap((round, i) => round.map((entry, j) => (
              <div key={`${i}-${j}`} className="rounded border border-slate-700/40 bg-slate-900/40 p-2">
                <div className="text-blue-300">{entry.tool}</div>
                <div className="text-slate-400 mt-1 break-words">
                  in: {JSON.stringify(entry.input).slice(0, 200)}
                </div>
                <div className="text-emerald-400 mt-1 break-words">
                  out: {JSON.stringify(entry.output).slice(0, 300)}
                </div>
              </div>
            )))}
          </div>
        </div>
      </div>
    </div>
  );
}
