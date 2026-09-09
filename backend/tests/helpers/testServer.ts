import type { Express } from 'express';

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export function startTestServer(app: Express): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0);

    server.once('error', reject);

    server.once('listening', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Expected server to bind to a network port.'));
        return;
      }

      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) {
                rejectClose(err);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}
