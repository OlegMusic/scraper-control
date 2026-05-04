import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes, NavLink, Navigate, useLocation } from 'react-router-dom';
import './index.css';
import { Dashboard } from './pages/Dashboard';
import { Schedule } from './pages/Schedule';
import { Stats } from './pages/Stats';
import { Settings } from './pages/Settings';
import { Director } from './pages/Director';
import { ProxyPage } from './pages/Proxy';
import { Database } from './pages/Database';
import { SEO } from './pages/SEO';
import { Agents } from './pages/Agents';
import { GlobalChat } from './components/GlobalChat';

class RouteErrorBoundary extends React.Component<
  { resetKey: string; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[RouteErrorBoundary]', error, info);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-sm">
          <div className="font-semibold text-red-300 mb-2">Страница упала с ошибкой</div>
          <pre className="text-xs whitespace-pre-wrap text-red-200/80">{String(this.state.error?.stack || this.state.error)}</pre>
          <div className="mt-3 text-xs text-slate-400">Меню сверху работает — переключись на другую вкладку.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RoutesWithBoundary() {
  const loc = useLocation();
  return (
    <RouteErrorBoundary resetKey={loc.pathname}>
      <Routes>
        <Route path="/" element={<Navigate to="/director" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/director" element={<Director />} />
        <Route path="/proxy" element={<ProxyPage />} />
        <Route path="/database" element={<Database />} />
        <Route path="/seo" element={<SEO />} />
        <Route path="/agents" element={<Agents />} />
      </Routes>
    </RouteErrorBoundary>
  );
}

function Shell() {
  const tab = (to: string, icon: string, label: string) => (
    <NavLink to={to} className={({ isActive }) =>
      `pill ${isActive ? 'pill-active' : ''}`
    }>
      <span className="text-base">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 px-6 pt-4 pb-3">
        <div className="max-w-[1500px] mx-auto rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl shadow-xl shadow-black/20">
          <div className="px-5 py-3 flex items-center gap-4">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-blue-500/30">
                SC
              </div>
              <div className="flex flex-col leading-tight">
                <span className="font-semibold text-base">Scraper Control</span>
                <span className="text-[10px] text-slate-400 -mt-0.5">Content Factory · Handwerker</span>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex gap-1.5 ml-2 overflow-x-auto">
              {tab('/director', '🤖', 'Директор')}
              {tab('/agents', '🧠', 'Агенты')}
              {tab('/dashboard', '⚡', 'Скраперы')}
              {tab('/database', '🗄', 'База')}
              {tab('/seo', '🎯', 'SEO')}
              {tab('/schedule', '⏰', 'Расписание')}
              {tab('/stats', '📊', 'Статистика')}
              {tab('/proxy', '🌐', 'Прокси')}
              {tab('/settings', '⚙', 'Настройки')}
            </nav>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-[1500px] mx-auto px-6 pb-10 w-full fade-up">
        <RoutesWithBoundary />
      </main>
      <GlobalChat />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </React.StrictMode>
);
