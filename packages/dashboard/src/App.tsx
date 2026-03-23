import { createContext, useContext, useMemo, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import {
  describeGatewayTarget,
  normaliseGatewayUrl,
  persistAdminToken,
  persistGatewayUrl,
  readInitialDashboardSettings,
  type DashboardSettings,
} from './lib/settings';
import { OverviewPage } from './pages/Overview';
import { RulesPage } from './pages/Rules';

interface DashboardShellContextValue {
  draftAdminToken: string;
  draftGatewayUrl: string;
  saveAdminToken: () => void;
  saveGatewayUrl: () => void;
  savedMessage: string;
  setDraftAdminToken: (value: string) => void;
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
  const [settings, setSettings] = useState<DashboardSettings>(() => readInitialDashboardSettings());
  const [draftGatewayUrl, setDraftGatewayUrl] = useState(settings.gatewayUrl);
  const [draftAdminToken, setDraftAdminToken] = useState(settings.adminToken);
  const [savedMessage, setSavedMessage] = useState('Live polling uses the last saved target.');

  const contextValue = useMemo<DashboardShellContextValue>(
    () => ({
      settings,
      draftGatewayUrl,
      setDraftGatewayUrl,
      draftAdminToken,
      setDraftAdminToken,
      savedMessage,
      saveGatewayUrl: () => {
        const nextGatewayUrl = normaliseGatewayUrl(draftGatewayUrl);
        persistGatewayUrl(nextGatewayUrl);
        setSettings((current) => ({
          ...current,
          gatewayUrl: nextGatewayUrl,
        }));
        setSavedMessage(`Gateway target saved: ${describeGatewayTarget(nextGatewayUrl)}`);
      },
      saveAdminToken: () => {
        persistAdminToken(draftAdminToken);
        setSettings((current) => ({
          ...current,
          adminToken: draftAdminToken.trim(),
        }));
        setSavedMessage(
          draftAdminToken.trim() ? 'Admin JWT saved in this browser.' : 'Admin JWT cleared.',
        );
      },
    }),
    [draftAdminToken, draftGatewayUrl, savedMessage, settings],
  );

  return (
    <DashboardShellContext.Provider value={contextValue}>
      <div className="dashboard-shell">
        <header className="masthead">
          <div className="masthead-copy">
            <span className="eyebrow">RateForge dashboard</span>
            <h1>Traffic stories, not raw counters.</h1>
            <p>
              Watch live gateway pressure, blocked traffic, client hotspots, and rules
              administration from one control surface tied directly to the existing API gateway.
            </p>
          </div>
          <div className="masthead-status">
            <div className="status-tile">
              <span className="status-label">Active target</span>
              <strong>{describeGatewayTarget(settings.gatewayUrl)}</strong>
            </div>
            <div className="status-tile">
              <span className="status-label">Admin access</span>
              <strong>{settings.adminToken ? 'Configured' : 'Optional until rules work'}</strong>
            </div>
          </div>
        </header>

        <section className="control-dock panel">
          <div className="dock-field">
            <label htmlFor="gateway-url">Gateway URL</label>
            <input
              id="gateway-url"
              type="url"
              value={draftGatewayUrl}
              onChange={(event) => setDraftGatewayUrl(event.target.value)}
              placeholder="https://api-gateway.example.com"
            />
          </div>
          <button className="button-primary" type="button" onClick={contextValue.saveGatewayUrl}>
            Save target
          </button>
          <div className="dock-field">
            <label htmlFor="admin-token">Admin JWT</label>
            <input
              id="admin-token"
              type="password"
              value={draftAdminToken}
              onChange={(event) => setDraftAdminToken(event.target.value)}
              placeholder="Paste the token without the Bearer prefix"
            />
          </div>
          <button className="button-secondary" type="button" onClick={contextValue.saveAdminToken}>
            Save token
          </button>
          <p className="dock-note">{savedMessage}</p>
        </section>

        <nav className="section-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-pill${isActive ? ' nav-pill-active' : ''}`}
          >
            Overview
          </NavLink>
          <NavLink
            to="/rules"
            className={({ isActive }) => `nav-pill${isActive ? ' nav-pill-active' : ''}`}
          >
            Rules
          </NavLink>
        </nav>

        <Outlet />
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
