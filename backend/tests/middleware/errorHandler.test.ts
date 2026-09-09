import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import express from 'express';

import { AppError } from '../../src/errors/AppError.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { notFoundHandler } from '../../src/middleware/notFound.js';
import { requestLogger } from '../../src/middleware/requestLogger.js';
import { startTestServer, type TestServer } from '../helpers/testServer.js';

function buildHarnessApp(): express.Express {
  const app = express();

  app.use(requestLogger);
  app.use(express.json());

  app.get('/boom-sync', () => {
    throw new Error('boom: leaked secret');
  });

  app.get('/boom-async', async () => {
    await Promise.resolve();
    throw new Error('boom: leaked secret');
  });

  app.get('/bad-request', () => {
    throw AppError.badRequest('bad thing', { field: 'x' });
  });

  app.get('/not-found', (_req, _res, next) => {
    next(AppError.notFound('nope'));
  });

  app.get('/boom-string', () => {
    throw 'plain string';
  });

  app.get('/sent-then-throw', (_req, res) => {
    res.status(200).json({ ok: true });
    throw new Error('too late');
  });

  app.get('/ok', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

let server: TestServer;

before(async () => {
  server = await startTestServer(buildHarnessApp());
});

after(async () => {
  await server.close();
});

test('sync throw produces a generic 500 envelope, never leaking the message', async () => {
  const res = await fetch(`${server.url}/boom-sync`);
  const text = await res.text();
  const body = JSON.parse(text) as { error: { code: string; message: string } };

  assert.equal(res.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, 'An unexpected error occurred');
  assert.ok(!text.includes('leaked secret'));
  assert.ok(!text.includes('.ts:'));
});

test('async throw resolves with the same 500 envelope instead of hanging', async () => {
  const res = await fetch(`${server.url}/boom-async`);
  const text = await res.text();
  const body = JSON.parse(text) as { error: { code: string; message: string } };

  assert.equal(res.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, 'An unexpected error occurred');
  assert.ok(!text.includes('leaked secret'));
});

test('AppError.badRequest passes through message, code, and details', async () => {
  const res = await fetch(`${server.url}/bad-request`);
  const body = (await res.json()) as {
    error: { code: string; message: string; details: unknown };
  };

  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'BAD_REQUEST');
  assert.equal(body.error.message, 'bad thing');
  assert.deepEqual(body.error.details, { field: 'x' });
});

test('next(AppError.notFound(...)) omits the details key entirely', async () => {
  const res = await fetch(`${server.url}/not-found`);
  const body = (await res.json()) as { error: Record<string, unknown> };

  assert.equal(res.status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.ok(!('details' in body.error));
});

test('throwing a non-Error value still yields the generic 500 envelope', async () => {
  const res = await fetch(`${server.url}/boom-string`);
  const body = (await res.json()) as { error: { code: string; message: string } };

  assert.equal(res.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, 'An unexpected error occurred');
});

test('a route that sends a response and then throws does not get rewritten', async () => {
  const res = await fetch(`${server.url}/sent-then-throw`);
  assert.equal(res.status, 200);

  const followUp = await fetch(`${server.url}/ok`);
  assert.equal(followUp.status, 200);
});

test('GET /ok succeeds after all the above — the server stays running', async () => {
  const res = await fetch(`${server.url}/ok`);
  const body = (await res.json()) as { ok: boolean };

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
});
