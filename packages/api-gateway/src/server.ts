import { PORT } from '@rateforge/config';

import { app, initApp } from './app';
import { logger, getErrorMeta } from './utils/logger';

const port = PORT ?? 3000;

app.listen(port, () => {
  logger.info({
    message: 'API gateway server listening',
    event: 'server.started',
    port,
  });
  // Initialise rules and start hot-reload watcher after server is up
  initApp().catch((err: unknown) => {
    logger.error({
      message: 'API gateway initialisation failed',
      event: 'server.init_failed',
      port,
      ...getErrorMeta(err),
    });
    process.exit(1);
  });
});
