import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  // Plain console.log is acceptable here only until T03 introduces the
  // logger (ADR-4), which replaces this line.
  console.log(`Server listening on port ${env.PORT}`);
});

function shutdown(): void {
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
