import { PORT } from '@rateforge/config';

import { app, initApp } from './app';

const port = PORT ?? 3000;

app.listen(port, () => {
  console.info(`[api-gateway] Server listening on port ${port}`);
  // Initialise rules and start hot-reload watcher after server is up
  initApp().catch((err: unknown) => {
    console.error('[api-gateway] Failed to initialise app:', err);
    process.exit(1);
  });
});
