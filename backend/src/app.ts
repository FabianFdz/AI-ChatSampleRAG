import express, { type Express } from 'express';

import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';
import { requestLogger } from './middleware/requestLogger.js';
import routes from './routes/index.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
