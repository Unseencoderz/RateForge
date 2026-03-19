const root = document.querySelector<HTMLDivElement>('#root');
if (root) {
  root.innerHTML = `
    <div style="font-family:system-ui,sans-serif;padding:2rem;max-width:800px;margin:auto">
      <h1 style="color:#6366f1">RateForge Dashboard</h1>
      <p>Monitoring service is initialising…</p>
    </div>
  `;
}
