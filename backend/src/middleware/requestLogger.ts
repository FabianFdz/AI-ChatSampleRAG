import { randomUUID } from 'node:crypto';

import { pinoHttp } from 'pino-http';
import type { Request } from 'express';

import { logger } from '../utils/logger.js';

export const requestLogger = pinoHttp({
  logger,
  genReqId: () => randomUUID(),
  autoLogging: {
    ignore: (req: Request) => req.url === '/health',
  },
});
