import { Router, type Request, type Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'ai-chat-rag-backend',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
