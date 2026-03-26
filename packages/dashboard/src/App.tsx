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
  const pageTitle = onRulesPage ? 'Policies' : 'Metrics Heartbeat';
  const pageStatus = onRulesPage ? 'SYSTEM READY' : 'LIVE VIEW';
  const pageSummary = onRulesPage
    ? 'Compose logic-based enforcement rules and push the full policy set through the existing admin API.'
    : 'Real-time behavior analysis for the gateway control plane, grounded directly in the live Prometheus feed.';

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
      <div className="console-shell">
        <aside className="sidebar-rail">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              <span>RF</span>
            </div>
            <div>
              <strong>RateForge</strong>
              <span>API gateway</span>
            </div>
          </div>

          <div className="sidebar-stack">
            <section className="sidebar-block">
              <span className="sidebar-caption">Control surface</span>
              <nav className="rail-nav">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `rail-item${isActive ? ' rail-item-active' : ''}`}
                >
                  <span className="rail-index">01</span>
                  <span>Traffic Stories</span>
                </NavLink>
                <NavLink
                  to="/rules"
                  className={({ isActive }) => `rail-item${isActive ? ' rail-item-active' : ''}`}
                >
                  <span className="rail-index">02</span>
                  <span>Policies</span>
                </NavLink>
                <div className="rail-item rail-item-muted">
                  <span className="rail-index">03</span>
                  <span>Active Target</span>
                </div>
                <div className="rail-item rail-item-muted">
                  <span className="rail-index">04</span>
                  <span>Admin Surface</span>
                </div>
              </nav>
            </section>

            <section className="sidebar-card panel panel-inset">
              <span className="section-kicker">Runtime target</span>
              <strong>{describeGatewayTarget(settings.gatewayUrl)}</strong>
              <p className="sidebar-copy">
                The dashboard keeps polling the last saved gateway endpoint until you replace it.
              </p>
            </section>

            <section className="sidebar-card panel panel-inset">
              <span className="section-kicker">Admin access</span>
              <strong>
                {settings.adminPassphrase ? 'Passphrase armed' : 'Passphrase required'}
              </strong>
              <p className="sidebar-copy">
                Rules operations stay disabled until a gateway URL and enterprise passphrase are
                stored in this browser.
              </p>
            </section>

            <div className="sidebar-footnotes">
              <span>Docs</span>
              <span>Support</span>
            </div>
          </div>
        </aside>

        <main className="workspace-shell">
          <header className="command-header">
            <div className="command-heading">
              <div className="command-title-row">
                <h1>{pageTitle}</h1>
                <span className="system-pill system-pill-accent">{pageStatus}</span>
              </div>
              <p>{pageSummary}</p>
            </div>
            <div className="command-meta">
              <div className="meta-card">
                <span className="status-label">Cluster status</span>
                <strong>Gateway linked</strong>
              </div>
              <div className="meta-card">
                <span className="status-label">Operator</span>
                <strong>System Admin</strong>
              </div>
            </div>
          </header>

          <section className="hero-panel panel">
            <div className="hero-copy">
              <span className="eyebrow">RateForge dashboard</span>
              <h2>
                {onRulesPage
                  ? 'Compose policies with live guard rails.'
                  : 'Traffic stories, not raw counters.'}
              </h2>
              <p>
                {onRulesPage
                  ? 'Work against the existing admin endpoints from one policy surface, with the live gateway target and admin passphrase always in view.'
                  : 'Track gateway pressure, blocked traffic, client hotspots, and enforcement behavior from a single operations console tied to the existing gateway.'}
              </p>
            </div>

            <div className="control-dock">
              <div className="command-field">
                <label htmlFor="gateway-url">Gateway URL</label>
                <div className="field-shell">
                  <span className="field-prefix" aria-hidden="true">
                    G
                  </span>
                  <input
                    id="gateway-url"
                    type="url"
                    value={draftGatewayUrl}
                    onChange={(event) => setDraftGatewayUrl(event.target.value)}
                    placeholder="https://api-gateway.example.com"
                  />
                </div>
              </div>
              <button
                className="button-primary"
                type="button"
                onClick={contextValue.saveGatewayUrl}
              >
                Save target
              </button>
              <div className="command-field">
                <label htmlFor="admin-passphrase">Admin passphrase</label>
                <div className="field-shell">
                  <span className="field-prefix" aria-hidden="true">
                    A
                  </span>
                  <input
                    id="admin-passphrase"
                    type="password"
                    value={draftAdminPassphrase}
                    onChange={(event) => setDraftAdminPassphrase(event.target.value)}
                    placeholder="Enter the enterprise admin passphrase"
                  />
                </div>
              </div>
              <button
                className="button-secondary"
                type="button"
                onClick={contextValue.saveAdminPassphrase}
              >
                Save passphrase
              </button>
            </div>

            <p className="dock-note">{savedMessage}</p>
          </section>

          <nav className="section-nav">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `nav-pill${isActive ? ' nav-pill-active' : ''}`}
            >
              Traffic Stories
            </NavLink>
            <NavLink
              to="/rules"
              className={({ isActive }) => `nav-pill${isActive ? ' nav-pill-active' : ''}`}
            >
              Policies
            </NavLink>
          </nav>

          <Outlet />
        </main>
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
