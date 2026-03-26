import { createContext, useContext, useMemo, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { clearAdminSession } from './api/admin';
import {
  describeGatewayTarget,
  normaliseGatewayUrl,
  persistAdminPassphrase,
  persistGatewayUrl,
  readInitialDashboardSettings,
  type DashboardSettings,
} from './lib/settings';
import { OverviewPage } from './pages/Overview';
import { RulesPage } from './pages/Rules';

interface DashboardShellContextValue {
  draftAdminPassphrase: string;
  draftGatewayUrl: string;
  saveAdminPassphrase: () => void;
  saveGatewayUrl: () => void;
  savedMessage: string;
  setDraftAdminPassphrase: (value: string) => void;
  setDraftGatewayUrl: (value: string) => void;
  settings: DashboardSettings;
}

const DashboardShellContext = createContext<DashboardShellContextValue | null>(null);

const shellInputClass =
  'w-full rounded-md border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 placeholder:text-zinc-500';

const shellButtonPrimaryClass =
  'inline-flex items-center justify-center rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60';

const shellButtonSecondaryClass =
  'inline-flex items-center justify-center rounded-md border border-zinc-800 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60';

function sidebarLinkClass(isActive: boolean): string {
  return [
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
    isActive ? 'bg-white/5 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
  ].join(' ');
}

function sectionTabClass(isActive: boolean): string {
  return [
    'rounded-md px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-white/5 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200',
  ].join(' ');
}

function useDashboardShell(): DashboardShellContextValue {
  const context = useContext(DashboardShellContext);
  if (!context) {
    throw new Error('Dashboard shell context is unavailable.');
  }

  return context;
}

function DashboardShell() {
  const location = useLocation();
  const [settings, setSettings] = useState<DashboardSettings>(() => readInitialDashboardSettings());
  const [draftGatewayUrl, setDraftGatewayUrl] = useState(settings.gatewayUrl);
  const [draftAdminPassphrase, setDraftAdminPassphrase] = useState(settings.adminPassphrase);
  const [savedMessage, setSavedMessage] = useState('Live polling uses the last saved target.');
  const onRulesPage = location.pathname.startsWith('/rules');
  const pageTitle = onRulesPage ? 'Policies' : 'Metrics heartbeat';
  const pageSummary = onRulesPage
    ? 'Compose logic-based enforcement rules and ship them through the existing admin API.'
    : 'Real-time gateway pressure, throughput, and policy visibility from the existing Prometheus feed.';

  const contextValue = useMemo<DashboardShellContextValue>(
    () => ({
      settings,
      draftGatewayUrl,
      setDraftGatewayUrl,
      draftAdminPassphrase,
      setDraftAdminPassphrase,
      savedMessage,
      saveGatewayUrl: () => {
        const nextGatewayUrl = normaliseGatewayUrl(draftGatewayUrl);
        clearAdminSession();
        persistGatewayUrl(nextGatewayUrl);
        setSettings((current) => ({
          ...current,
          gatewayUrl: nextGatewayUrl,
        }));
        setSavedMessage(`Gateway target saved: ${describeGatewayTarget(nextGatewayUrl)}`);
      },
      saveAdminPassphrase: () => {
        const nextAdminPassphrase = draftAdminPassphrase.trim();
        clearAdminSession();
        persistAdminPassphrase(nextAdminPassphrase);
        setSettings((current) => ({
          ...current,
          adminPassphrase: nextAdminPassphrase,
        }));
        setSavedMessage(
          nextAdminPassphrase
            ? 'Admin passphrase saved in this browser.'
            : 'Admin passphrase cleared.',
        );
      },
    }),
    [draftAdminPassphrase, draftGatewayUrl, savedMessage, settings],
  );

  return (
    <DashboardShellContext.Provider value={contextValue}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto grid min-h-screen max-w-[1560px] grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
          <aside className="border-b border-zinc-800 lg:border-b-0 lg:border-r">
            <div className="flex h-full flex-col gap-8 px-4 py-5 sm:px-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 font-mono text-sm font-semibold text-cyan-300">
                  RF
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-100">RateForge</p>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    API gateway
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-500">
                  Navigation
                </p>
                <nav className="flex flex-col gap-1.5">
                  <NavLink to="/" end className={({ isActive }) => sidebarLinkClass(isActive)}>
                    <span className="font-mono text-xs text-zinc-500">01</span>
                    <span>Traffic stories</span>
                  </NavLink>
                  <NavLink to="/rules" className={({ isActive }) => sidebarLinkClass(isActive)}>
                    <span className="font-mono text-xs text-zinc-500">02</span>
                    <span>Policies</span>
                  </NavLink>
                  <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-600">
                    <span className="font-mono text-xs">03</span>
                    <span>Active target</span>
                  </div>
                  <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-600">
                    <span className="font-mono text-xs">04</span>
                    <span>Admin surface</span>
                  </div>
                </nav>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    Active target
                  </p>
                  <p className="mt-2 text-sm text-zinc-200">
                    {describeGatewayTarget(settings.gatewayUrl)}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    Admin access
                  </p>
                  <p className="mt-2 text-sm text-zinc-200">
                    {settings.adminPassphrase
                      ? 'Configured in this browser'
                      : 'Passphrase required'}
                  </p>
                </div>
              </div>

              <div className="mt-auto flex items-center gap-4 text-xs text-zinc-500">
                <span>Docs</span>
                <span>Support</span>
              </div>
            </div>
          </aside>

          <main className="flex min-w-0 flex-col gap-6 px-4 py-5 sm:px-6">
            <header className="flex flex-col gap-4 border-b border-zinc-800 pb-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
                    {pageTitle}
                  </h1>
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-300">
                    {onRulesPage ? 'system ready' : 'live view'}
                  </span>
                </div>
                <p className="max-w-3xl text-sm text-zinc-400">{pageSummary}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Cluster status
                  </p>
                  <p className="mt-1 text-sm text-zinc-200">Gateway linked</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Operator</p>
                  <p className="mt-1 text-sm text-zinc-200">System admin</p>
                </div>
              </div>
            </header>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
              <div className="space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-cyan-300">
                  RateForge dashboard
                </p>
                <div className="space-y-2">
                  <h2 className="text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
                    {onRulesPage
                      ? 'Operate the live policy surface with less ceremony.'
                      : 'Traffic stories, not raw counters.'}
                  </h2>
                  <p className="max-w-3xl text-sm leading-6 text-zinc-400">
                    {onRulesPage
                      ? 'Use the existing admin routes from a cleaner control surface. No workflow changes, only a tighter operational UI.'
                      : 'Watch gateway pressure, blocked traffic, and latency shifts from one dark, developer-first control surface backed by the same live metrics pipeline.'}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] xl:items-end">
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Gateway URL
                  </span>
                  <input
                    className={shellInputClass}
                    id="gateway-url"
                    type="url"
                    value={draftGatewayUrl}
                    onChange={(event) => setDraftGatewayUrl(event.target.value)}
                    placeholder="https://api-gateway.example.com"
                  />
                </label>
                <button
                  className={shellButtonPrimaryClass}
                  type="button"
                  onClick={contextValue.saveGatewayUrl}
                >
                  Save target
                </button>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Admin passphrase
                  </span>
                  <input
                    className={shellInputClass}
                    id="admin-passphrase"
                    type="password"
                    value={draftAdminPassphrase}
                    onChange={(event) => setDraftAdminPassphrase(event.target.value)}
                    placeholder="Enter the enterprise admin passphrase"
                  />
                </label>
                <button
                  className={shellButtonSecondaryClass}
                  type="button"
                  onClick={contextValue.saveAdminPassphrase}
                >
                  Save passphrase
                </button>
              </div>

              <p className="mt-4 text-sm text-zinc-500">{savedMessage}</p>
            </section>

            <nav className="inline-flex w-fit items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/30 p-1">
              <NavLink to="/" end className={({ isActive }) => sectionTabClass(isActive)}>
                Traffic stories
              </NavLink>
              <NavLink to="/rules" className={({ isActive }) => sectionTabClass(isActive)}>
                Policies
              </NavLink>
            </nav>

            <Outlet />
          </main>
        </div>
      </div>
    </DashboardShellContext.Provider>
  );
}

export function useDashboardShellContext(): DashboardShellContextValue {
  return useDashboardShell();
}

export default function App() {
  return (
    <Routes>
      <Route element={<DashboardShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="rules" element={<RulesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
