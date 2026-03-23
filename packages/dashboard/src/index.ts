interface EndpointState {
  body: string;
  label: string;
  ok: boolean;
  path: string;
  statusCode: number | null;
}

interface RuleRecord {
  algorithm: string;
  description?: string;
  enabled: boolean;
  endpointPattern: string;
  id: string;
  maxRequests: number;
  windowMs: number;
}

const GATEWAY_URL_STORAGE_KEY = 'rateforge.dashboard.gatewayUrl';
const ADMIN_TOKEN_STORAGE_KEY = 'rateforge.dashboard.adminToken';
const PLACEHOLDER_ENV_TOKEN = '%VITE_GATEWAY_URL%';

const styles = `
  :root {
    --bg: #f2ede2;
    --panel: rgba(255, 252, 245, 0.88);
    --panel-strong: #fffaf0;
    --text: #1f2220;
    --muted: #5c665f;
    --accent: #0f766e;
    --accent-soft: #d7efe7;
    --danger: #a63d32;
    --danger-soft: #f4d7d0;
    --warning: #946200;
    --warning-soft: #f7e7b8;
    --border: rgba(31, 34, 32, 0.12);
    --shadow: 0 18px 48px rgba(31, 34, 32, 0.08);
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-height: 100vh;
    font-family: "Segoe UI", "Trebuchet MS", system-ui, sans-serif;
    color: var(--text);
    background:
      radial-gradient(circle at top left, rgba(15, 118, 110, 0.16), transparent 32%),
      radial-gradient(circle at top right, rgba(166, 61, 50, 0.12), transparent 28%),
      linear-gradient(180deg, #f8f2e6 0%, var(--bg) 48%, #ece4d6 100%);
  }

  .shell {
    width: min(1180px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 32px 0 48px;
  }

  .hero {
    display: grid;
    gap: 18px;
    padding: 28px;
    border: 1px solid var(--border);
    border-radius: 28px;
    background: linear-gradient(145deg, rgba(255, 250, 240, 0.97), rgba(245, 238, 224, 0.88));
    box-shadow: var(--shadow);
  }

  .eyebrow {
    display: inline-flex;
    width: fit-content;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(15, 118, 110, 0.1);
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .hero h1 {
    margin: 0;
    font-size: clamp(2rem, 4vw, 3.4rem);
    line-height: 0.98;
    letter-spacing: -0.05em;
  }

  .hero p {
    margin: 0;
    max-width: 760px;
    color: var(--muted);
    font-size: 1rem;
    line-height: 1.65;
  }

  .toolbar,
  .grid {
    display: grid;
    gap: 18px;
    margin-top: 18px;
  }

  .toolbar {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .grid {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .panel {
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 22px;
    background: var(--panel);
    box-shadow: var(--shadow);
    backdrop-filter: blur(12px);
  }

  .panel h2,
  .panel h3,
  .panel h4 {
    margin: 0 0 10px;
    letter-spacing: -0.03em;
  }

  .panel p {
    margin: 0;
    color: var(--muted);
    line-height: 1.55;
  }

  label {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }

  input {
    width: 100%;
    padding: 13px 14px;
    border: 1px solid rgba(31, 34, 32, 0.16);
    border-radius: 14px;
    background: var(--panel-strong);
    color: var(--text);
    font: inherit;
  }

  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
  }

  button {
    cursor: pointer;
    border: 0;
    border-radius: 999px;
    padding: 11px 16px;
    font: inherit;
    font-weight: 700;
    transition: transform 0.16s ease, opacity 0.16s ease, background 0.16s ease;
  }

  button:hover {
    transform: translateY(-1px);
  }

  button:disabled {
    cursor: wait;
    opacity: 0.65;
    transform: none;
  }

  .primary-button {
    background: var(--accent);
    color: white;
  }

  .secondary-button {
    background: rgba(31, 34, 32, 0.08);
    color: var(--text);
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
    padding: 7px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .status-pill::before {
    content: "";
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: currentColor;
  }

  .status-good {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .status-bad {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .status-pending {
    background: var(--warning-soft);
    color: var(--warning);
  }

  .metric {
    display: grid;
    gap: 12px;
  }

  .metric-head {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 12px;
  }

  .metric strong {
    font-size: 1.35rem;
    letter-spacing: -0.04em;
  }

  .metric small {
    color: var(--muted);
  }

  pre {
    margin: 12px 0 0;
    padding: 14px;
    overflow-x: auto;
    border-radius: 16px;
    border: 1px solid rgba(31, 34, 32, 0.08);
    background: rgba(31, 34, 32, 0.92);
    color: #ecf4ef;
    font-size: 12px;
    line-height: 1.55;
  }

  .notes {
    display: grid;
    gap: 12px;
  }

  .note {
    padding: 14px 16px;
    border-radius: 16px;
    background: rgba(31, 34, 32, 0.05);
    color: var(--muted);
  }

  .rules-list {
    display: grid;
    gap: 12px;
    margin-top: 12px;
  }

  .rule-card {
    padding: 14px 16px;
    border-radius: 16px;
    border: 1px solid rgba(31, 34, 32, 0.1);
    background: var(--panel-strong);
  }

  .rule-card strong {
    display: block;
    margin-bottom: 6px;
  }

  .rule-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .rule-chip {
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(15, 118, 110, 0.08);
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
  }

  .empty {
    margin-top: 12px;
    padding: 14px 16px;
    border-radius: 16px;
    background: rgba(148, 98, 0, 0.08);
    color: var(--warning);
  }

  @media (max-width: 720px) {
    .shell {
      width: min(100vw - 20px, 100%);
      padding-top: 20px;
    }

    .hero,
    .panel {
      padding: 18px;
      border-radius: 20px;
    }
  }
`;

function readConfiguredGatewayUrl(): string {
  const saved = window.localStorage.getItem(GATEWAY_URL_STORAGE_KEY)?.trim();
  if (saved) {
    return saved;
  }

  const meta = document
    .querySelector<HTMLMetaElement>('meta[name="rateforge-gateway-url"]')
    ?.content.trim();

  if (meta && meta !== PLACEHOLDER_ENV_TOKEN) {
    return meta;
  }

  return 'http://localhost:3000';
}

function readSavedAdminToken(): string {
  return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';
}

function normaliseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

async function fetchEndpoint(
  gatewayUrl: string,
  path: string,
  init?: RequestInit,
): Promise<EndpointState> {
  const response = await fetch(`${gatewayUrl}${path}`, init);
  const body = await response.text();
  return {
    path,
    statusCode: response.status,
    ok: response.ok,
    label: response.ok ? 'reachable' : 'error',
    body,
  };
}

function safeJsonPreview(body: string): string {
  if (!body) {
    return 'No response body.';
  }

  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function statusClass(ok: boolean | null): string {
  if (ok === null) {
    return 'status-pending';
  }

  return ok ? 'status-good' : 'status-bad';
}

function statusLabel(ok: boolean | null, successText: string, pendingText: string): string {
  if (ok === null) {
    return pendingText;
  }

  return ok ? successText : 'needs attention';
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return 'No checks run yet.';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp);
}

function renderRuleCards(rules: RuleRecord[]): string {
  if (rules.length === 0) {
    return '<div class="empty">No rules loaded yet. Save an admin JWT and run "Load Rules".</div>';
  }

  return rules
    .map((rule) => {
      const description = rule.description ?? 'No description provided.';
      return `
        <article class="rule-card">
          <strong>${rule.id}</strong>
          <p>${description}</p>
          <div class="rule-meta">
            <span class="rule-chip">${rule.algorithm}</span>
            <span class="rule-chip">${rule.maxRequests} req / ${Math.round(rule.windowMs / 1000)}s</span>
            <span class="rule-chip">${rule.enabled ? 'enabled' : 'disabled'}</span>
            <span class="rule-chip">${rule.endpointPattern}</span>
          </div>
        </article>
      `;
    })
    .join('');
}

function boot(): void {
  const root = document.querySelector<HTMLDivElement>('#root');
  if (!root) {
    return;
  }

  const initialGatewayUrl = readConfiguredGatewayUrl();
  const initialToken = readSavedAdminToken();

  root.innerHTML = `
    <style>${styles}</style>
    <main class="shell">
      <section class="hero">
        <span class="eyebrow">RateForge Dashboard</span>
        <h1>Deployment checks, not guesswork.</h1>
        <p>
          This dashboard verifies the gateway and readiness path in real time.
          It also lets you inspect admin rules with an optional JWT so production
          checks stop at facts instead of placeholder text.
        </p>
      </section>

      <section class="toolbar">
        <article class="panel">
          <h2>Gateway Target</h2>
          <p>Point the dashboard at the live API gateway you want to validate.</p>
          <div style="margin-top:14px">
            <label for="gateway-url">Gateway URL</label>
            <input id="gateway-url" type="url" value="${initialGatewayUrl}" placeholder="https://api-gateway.example.com" />
          </div>
          <div class="button-row">
            <button id="save-gateway" class="secondary-button" type="button">Save Target</button>
            <button id="refresh-status" class="primary-button" type="button">Refresh Checks</button>
          </div>
        </article>

        <article class="panel">
          <h2>Admin Access</h2>
          <p>Paste an admin JWT only if you want to load protected rule data.</p>
          <div style="margin-top:14px">
            <label for="admin-token">Admin JWT</label>
            <input id="admin-token" type="password" value="${initialToken}" placeholder="Bearer token without the Bearer prefix" />
          </div>
          <div class="button-row">
            <button id="save-token" class="secondary-button" type="button">Save Token</button>
            <button id="load-rules" class="primary-button" type="button">Load Rules</button>
          </div>
        </article>
      </section>

      <section class="grid">
        <article class="panel metric">
          <div class="metric-head">
            <div>
              <small>Gateway health</small>
              <strong>/health</strong>
            </div>
            <span id="health-pill" class="status-pill status-pending">waiting</span>
          </div>
          <p id="health-summary">Run a check to verify the API gateway process is alive.</p>
          <pre id="health-body">No response yet.</pre>
        </article>

        <article class="panel metric">
          <div class="metric-head">
            <div>
              <small>Gateway readiness</small>
              <strong>/ready</strong>
            </div>
            <span id="ready-pill" class="status-pill status-pending">waiting</span>
          </div>
          <p id="ready-summary">Run a check to verify Redis and the limiter are reachable.</p>
          <pre id="ready-body">No response yet.</pre>
        </article>

        <article class="panel metric">
          <div class="metric-head">
            <div>
              <small>Last refresh</small>
              <strong id="last-checked">No checks run yet.</strong>
            </div>
            <span id="rules-pill" class="status-pill status-pending">optional</span>
          </div>
          <p id="rules-summary">Protected rule inspection needs an admin JWT.</p>
          <pre id="rules-body">No rule data loaded yet.</pre>
        </article>
      </section>

      <section class="grid">
        <article class="panel">
          <h3>Protected Rules</h3>
          <p>The active rule list below comes from <code>/api/v1/admin/rules</code>.</p>
          <div id="rules-list" class="rules-list">
            <div class="empty">No rules loaded yet. Save an admin JWT and run "Load Rules".</div>
          </div>
        </article>

        <article class="panel notes">
          <h3>What this page proves</h3>
          <div class="note">
            The gateway process is reachable and returning live health responses.
          </div>
          <div class="note">
            Readiness confirms whether Redis and the rate-limiter dependency are available.
          </div>
          <div class="note">
            Admin rule loading verifies authentication plus the shared rule pipeline.
          </div>
        </article>
      </section>
    </main>
  `;

  const gatewayInput = document.querySelector<HTMLInputElement>('#gateway-url');
  const adminTokenInput = document.querySelector<HTMLInputElement>('#admin-token');
  const saveGatewayButton = document.querySelector<HTMLButtonElement>('#save-gateway');
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-status');
  const saveTokenButton = document.querySelector<HTMLButtonElement>('#save-token');
  const loadRulesButton = document.querySelector<HTMLButtonElement>('#load-rules');
  const healthPill = document.querySelector<HTMLSpanElement>('#health-pill');
  const readyPill = document.querySelector<HTMLSpanElement>('#ready-pill');
  const rulesPill = document.querySelector<HTMLSpanElement>('#rules-pill');
  const healthSummary = document.querySelector<HTMLParagraphElement>('#health-summary');
  const readySummary = document.querySelector<HTMLParagraphElement>('#ready-summary');
  const rulesSummary = document.querySelector<HTMLParagraphElement>('#rules-summary');
  const healthBody = document.querySelector<HTMLElement>('#health-body');
  const readyBody = document.querySelector<HTMLElement>('#ready-body');
  const rulesBody = document.querySelector<HTMLElement>('#rules-body');
  const rulesList = document.querySelector<HTMLDivElement>('#rules-list');
  const lastChecked = document.querySelector<HTMLElement>('#last-checked');

  if (
    !gatewayInput ||
    !adminTokenInput ||
    !saveGatewayButton ||
    !refreshButton ||
    !saveTokenButton ||
    !loadRulesButton ||
    !healthPill ||
    !readyPill ||
    !rulesPill ||
    !healthSummary ||
    !readySummary ||
    !rulesSummary ||
    !healthBody ||
    !readyBody ||
    !rulesBody ||
    !rulesList ||
    !lastChecked
  ) {
    return;
  }

  const gatewayField = gatewayInput;
  const adminTokenField = adminTokenInput;
  const saveGatewayControl = saveGatewayButton;
  const refreshControl = refreshButton;
  const saveTokenControl = saveTokenButton;
  const loadRulesControl = loadRulesButton;
  const healthStatusPill = healthPill;
  const readyStatusPill = readyPill;
  const rulesStatusPill = rulesPill;
  const healthStatusSummary = healthSummary;
  const readyStatusSummary = readySummary;
  const rulesStatusSummary = rulesSummary;
  const healthStatusBody = healthBody;
  const readyStatusBody = readyBody;
  const rulesStatusBody = rulesBody;
  const rulesStatusList = rulesList;
  const lastCheckedText = lastChecked;

  const state = {
    gatewayUrl: normaliseUrl(initialGatewayUrl),
    adminToken: initialToken.trim(),
    lastRefreshAt: null as number | null,
    health: null as EndpointState | null,
    ready: null as EndpointState | null,
    rules: [] as RuleRecord[],
  };

  function updateEndpointView(
    pill: HTMLSpanElement,
    summary: HTMLParagraphElement,
    body: HTMLElement,
    endpoint: EndpointState | null,
    successText: string,
    waitingText: string,
  ): void {
    const ok = endpoint ? endpoint.ok : null;
    pill.className = `status-pill ${statusClass(ok)}`;
    pill.textContent = statusLabel(ok, successText, waitingText);

    if (!endpoint) {
      summary.textContent = waitingText;
      body.textContent = 'No response yet.';
      return;
    }

    summary.textContent = `${endpoint.path} responded with HTTP ${endpoint.statusCode ?? 'n/a'}.`;
    body.textContent = safeJsonPreview(endpoint.body);
  }

  function render(): void {
    state.gatewayUrl = normaliseUrl(gatewayField.value);
    state.adminToken = adminTokenField.value.trim();

    updateEndpointView(
      healthStatusPill,
      healthStatusSummary,
      healthStatusBody,
      state.health,
      'healthy',
      'Waiting for health check.',
    );
    updateEndpointView(
      readyStatusPill,
      readyStatusSummary,
      readyStatusBody,
      state.ready,
      'ready',
      'Waiting for readiness check.',
    );

    const rulesLoaded = state.rules.length > 0;
    rulesStatusPill.className = `status-pill ${statusClass(rulesLoaded ? true : null)}`;
    rulesStatusPill.textContent = rulesLoaded ? 'loaded' : 'optional';
    rulesStatusSummary.textContent = rulesLoaded
      ? `Loaded ${state.rules.length} protected rule(s) from ${state.gatewayUrl || 'the configured gateway'}.`
      : 'Protected rule inspection needs an admin JWT.';
    rulesStatusBody.textContent = rulesLoaded
      ? JSON.stringify(state.rules, null, 2)
      : 'No rule data loaded yet.';
    rulesStatusList.innerHTML = renderRuleCards(state.rules);
    lastCheckedText.textContent = formatTimestamp(state.lastRefreshAt);
  }

  async function refreshChecks(): Promise<void> {
    const gatewayUrl = normaliseUrl(gatewayField.value);
    if (!gatewayUrl) {
      window.alert('Enter a gateway URL before running deployment checks.');
      return;
    }

    refreshControl.disabled = true;
    refreshControl.textContent = 'Checking...';

    try {
      const [health, ready] = await Promise.all([
        fetchEndpoint(gatewayUrl, '/health'),
        fetchEndpoint(gatewayUrl, '/ready'),
      ]);

      state.gatewayUrl = gatewayUrl;
      state.health = health;
      state.ready = ready;
      state.lastRefreshAt = Date.now();
      render();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.health = {
        path: '/health',
        ok: false,
        statusCode: null,
        label: 'error',
        body: message,
      };
      state.ready = {
        path: '/ready',
        ok: false,
        statusCode: null,
        label: 'error',
        body: message,
      };
      state.lastRefreshAt = Date.now();
      render();
    } finally {
      refreshControl.disabled = false;
      refreshControl.textContent = 'Refresh Checks';
    }
  }

  async function loadRules(): Promise<void> {
    const gatewayUrl = normaliseUrl(gatewayField.value);
    const token = adminTokenField.value.trim();

    if (!gatewayUrl) {
      window.alert('Enter a gateway URL before loading rules.');
      return;
    }

    if (!token) {
      window.alert('Paste an admin JWT before loading protected rules.');
      return;
    }

    loadRulesControl.disabled = true;
    loadRulesControl.textContent = 'Loading...';

    try {
      const response = await fetchEndpoint(gatewayUrl, '/api/v1/admin/rules', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      state.lastRefreshAt = Date.now();

      if (response.ok) {
        const parsed = JSON.parse(response.body) as { data?: RuleRecord[] };
        state.rules = parsed.data ?? [];
      } else {
        state.rules = [];
      }

      rulesStatusPill.className = `status-pill ${statusClass(response.ok)}`;
      rulesStatusPill.textContent = response.ok ? 'loaded' : 'denied';
      rulesStatusSummary.textContent = response.ok
        ? `Loaded ${state.rules.length} protected rule(s).`
        : `Rules request failed with HTTP ${response.statusCode ?? 'n/a'}.`;
      rulesStatusBody.textContent = safeJsonPreview(response.body);
      rulesStatusList.innerHTML = renderRuleCards(state.rules);
      lastCheckedText.textContent = formatTimestamp(state.lastRefreshAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.rules = [];
      state.lastRefreshAt = Date.now();
      rulesStatusPill.className = 'status-pill status-bad';
      rulesStatusPill.textContent = 'error';
      rulesStatusSummary.textContent = 'Failed to reach the protected rules endpoint.';
      rulesStatusBody.textContent = message;
      rulesStatusList.innerHTML = renderRuleCards(state.rules);
      lastCheckedText.textContent = formatTimestamp(state.lastRefreshAt);
    } finally {
      loadRulesControl.disabled = false;
      loadRulesControl.textContent = 'Load Rules';
    }
  }

  saveGatewayControl.addEventListener('click', () => {
    const value = normaliseUrl(gatewayField.value);
    window.localStorage.setItem(GATEWAY_URL_STORAGE_KEY, value);
    state.gatewayUrl = value;
    render();
  });

  saveTokenControl.addEventListener('click', () => {
    const value = adminTokenField.value.trim();
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, value);
    state.adminToken = value;
    render();
  });

  refreshControl.addEventListener('click', () => {
    void refreshChecks();
  });

  loadRulesControl.addEventListener('click', () => {
    void loadRules();
  });

  render();
  void refreshChecks();
}

boot();
