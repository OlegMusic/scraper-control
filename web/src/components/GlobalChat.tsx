import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface ChatMsg { role: 'user' | 'assistant'; content: string; }

const SUGGESTIONS = [
  'Сколько Friseur в Berlin без сайта?',
  'Покажи Tischler в München с TikTok',
  'Кто зарегистрировал YT канал в 2024?',
  'Сравни coverage email по Top 10 городов',
  'Какие города собраны хуже всего?',
  'Запусти audit для всех Friseur в Hamburg',
];

export function GlobalChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'db' | 'director'>('db');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');
    const next = [...messages, { role: 'user' as const, content: msg }];
    setMessages(next);
    setLoading(true);
    try {
      const endpoint = mode === 'db' ? '/db-chat/chat' : '/director/chat';
      const r = await api.post<{ reply: string }>(endpoint, { messages: next });
      setMessages([...next, { role: 'assistant', content: r.data.reply }]);
    } catch (e: any) {
      setMessages([...next, { role: 'assistant', content: `❌ ${e.response?.data?.error || e.message}` }]);
    } finally { setLoading(false); }
  }

  return (
    <>
      {/* Floating trigger */}
      <button onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-[60] px-5 py-3 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-2xl shadow-blue-500/30 text-sm font-medium flex items-center gap-2">
        <span className="text-base">{open ? '✕' : '💬'}</span>
        {!open && <span>{mode === 'db' ? 'DB Chat' : 'Director'}</span>}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-[60] w-[520px] max-h-[680px] flex flex-col rounded-2xl border border-white/10 bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-black/50">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <button onClick={() => setMode('db')}
              className={`pill text-xs ${mode === 'db' ? 'pill-active' : ''}`}>💬 DB</button>
            <button onClick={() => setMode('director')}
              className={`pill text-xs ${mode === 'director' ? 'pill-active' : ''}`}>🤖 Director</button>
            <button onClick={() => setMessages([])} className="ml-auto text-xs text-slate-400 hover:text-white">очистить</button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3 min-h-[360px]">
            {messages.length === 0 && (
              <div className="text-xs text-slate-400 space-y-3">
                <p className="text-sm">
                  {mode === 'db' ? '💬 Спрашивай про базу' : '🤖 Управление через текст'}
                </p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="block w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition">
                      "{s}"
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === 'user'
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                    : 'bg-white/5 text-slate-100 whitespace-pre-wrap border border-white/10'
                }`}>{m.content}</div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-2 bg-white/5 border border-white/10 text-slate-300 text-sm">
                  <span className="animate-pulse">Думаю...</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 p-3 flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={mode === 'db' ? 'Спроси про базу...' : 'Что сделать?'}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-800/60 border border-white/10 focus:border-blue-500 outline-none text-sm" />
            <button onClick={() => send()} disabled={loading || !input.trim()}
              className="px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-sm">➤</button>
          </div>
        </div>
      )}
    </>
  );
}
