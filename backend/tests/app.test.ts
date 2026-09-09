import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createApp } from '../src/app.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';

let server: TestServer;

before(async () => {
  server = await startTestServer(createApp());
});

after(async () => {
  await server.close();
});

test('GET /health returns 200 with JSON content-type', async () => {
  const res = await fetch(`${server.url}/health`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('application/json'));
});

test('GET /health body has exactly the expected keys and values', async () => {
  const res = await fetch(`${server.url}/health`);
  const body = (await res.json()) as Record<string, unknown>;

  assert.deepEqual(Object.keys(body).sort(), [
    'service',
    'status',
    'timestamp',
    'uptime',
  ]);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'ai-chat-rag-backend');
  assert.equal(typeof body.uptime, 'number');
  assert.equal(
    new Date(body.timestamp as string).toISOString(),
    body.timestamp,
  );
});

test('GET /health works twice in a row', async () => {
  const first = await fetch(`${server.url}/health`);
  const second = await fetch(`${server.url}/health`);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
});

test('GET /does-not-exist returns a 404 error envelope', async () => {
  const res = await fetch(`${server.url}/does-not-exist`);
  const body = (await res.json()) as {
    error: { code: string; message: string; requestId: string };
  };
  const text = JSON.stringify(body);

  assert.equal(res.status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.ok(body.error.message.includes('GET /does-not-exist'));
  assert.ok(
    typeof body.error.requestId === 'string' && body.error.requestId.length > 0,
  );
  assert.ok(!text.includes('stack'));
});

test('DELETE /health (known path, unknown method) returns 404 NOT_FOUND', async () => {
  const res = await fetch(`${server.url}/health`, { method: 'DELETE' });
  const body = (await res.json()) as { error: { code: string } };

  assert.equal(res.status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('POST /health with malformed JSON returns 400 INVALID_JSON', async () => {
  const res = await fetch(`${server.url}/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad',
  });
  const body = (await res.json()) as { error: { code: string } };

  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'INVALID_JSON');
});

test('x-powered-by header is absent', async () => {
  const res = await fetch(`${server.url}/health`);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('GET /__dev/boom is not reachable when NODE_ENV=test', async () => {
  const res = await fetch(`${server.url}/__dev/boom`);
  assert.equal(res.status, 404);
});
