import { Router, type Request, type Response } from 'express';

const router = Router();

router.get('/boom', (_req: Request, _res: Response) => {
  throw new Error('boom');
});

router.get('/boom-async', async (_req: Request, _res: Response) => {
  await Promise.resolve();
  throw new Error('boom');
});

export default router;
