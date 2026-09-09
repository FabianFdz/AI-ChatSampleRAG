import { Router } from 'express';

import { env } from '../config/env.js';
import devRouter from './dev.route.js';
import healthRouter from './health.route.js';

const router = Router();

router.use('/health', healthRouter);

if (env.isDevelopment) {
  router.use('/__dev', devRouter);
}

export default router;
