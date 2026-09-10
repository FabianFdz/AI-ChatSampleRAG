import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../../../src/errors/AppError.js';
import {
  createVoyageEmbeddingClient,
  type VoyageEmbedApi,
} from '../../../src/services/providers/voyageEmbeddingClient.js';
import { env } from '../../../src/config/env.js';

async function assertRejectsWithEmbeddingFailed(
  promise: Promise<unknown>,
): Promise<void> {
  await assert.rejects(promise, (err: unknown): boolean => {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'EMBEDDING_FAILED');
    assert.equal(err.statusCode, 502);
    return true;
  });
}

test('maps a successful response to vectors in input order, by index, not positional order', async () => {
  const fake: VoyageEmbedApi = {
    embed(request) {
      // Recorded body: items reversed relative to the input order.
      return Promise.resolve({
        object: 'list',
        data: [
          { object: 'embedding', index: 1, embedding: [2, 2] },
          { object: 'embedding', index: 0, embedding: [1, 1] },
        ],
        model: request.model,
      });
    },
  };
  const client = createVoyageEmbeddingClient(fake);

  const vectors = await client.embed(['first', 'second'], 'document');

  assert.deepEqual(vectors, [
    [1, 1],
    [2, 2],
  ]);
});

test('passes the env-configured model and maps the input kind onto inputType', async () => {
  let received: { model: string; inputType?: string } | undefined;
  const fake: VoyageEmbedApi = {
    embed(request) {
      received = { model: request.model, inputType: request.inputType };
      return Promise.resolve({
        data: request.input
          ? (Array.isArray(request.input) ? request.input : [request.input]).map(
              (_, index) => ({ index, embedding: [index] }),
            )
          : [],
      });
    },
  };
  const client = createVoyageEmbeddingClient(fake);

  await client.embed(['q'], 'query');

  assert.equal(received?.model, env.VOYAGE_EMBEDDING_MODEL);
  assert.equal(received?.inputType, 'query');
});

test('a thrown VoyageAIError (recorded non-2xx body) surfaces as EMBEDDING_FAILED without leaking the body', async () => {
  const fake: VoyageEmbedApi = {
    embed() {
      const err = new Error('Unauthorized') as Error & {
        statusCode: number;
        body: unknown;
      };
      err.statusCode = 401;
      err.body = { detail: 'Unauthorized' };
      return Promise.reject(err);
    },
  };
  const client = createVoyageEmbeddingClient(fake);

  try {
    await client.embed(['x'], 'document');
    assert.fail('expected embed to reject');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'EMBEDDING_FAILED');
    assert.equal(err.statusCode, 502);
    const serialised = JSON.stringify(err);
    assert.ok(!serialised.includes('Unauthorized'));
    assert.ok(!serialised.includes('detail'));
  }
});

test('a timeout throw surfaces as EMBEDDING_FAILED', async () => {
  const fake: VoyageEmbedApi = {
    embed() {
      return Promise.reject(new Error('timed out after 30s'));
    },
  };
  const client = createVoyageEmbeddingClient(fake);

  await assertRejectsWithEmbeddingFailed(client.embed(['x'], 'document'));
});

test('a malformed success body (item count mismatch) surfaces as EMBEDDING_FAILED, not an empty array', async () => {
  const fake: VoyageEmbedApi = {
    embed() {
      return Promise.resolve({ data: [{ index: 0, embedding: [1] }] });
    },
  };
  const client = createVoyageEmbeddingClient(fake);

  await assertRejectsWithEmbeddingFailed(client.embed(['a', 'b'], 'document'));
});

test('a malformed success body (missing data) surfaces as EMBEDDING_FAILED', async () => {
  const fake: VoyageEmbedApi = {
    embed() {
      return Promise.resolve({});
    },
  };
  const client = createVoyageEmbeddingClient(fake);

  await assertRejectsWithEmbeddingFailed(client.embed(['a'], 'document'));
});

test('a malformed success body (item missing embedding) surfaces as EMBEDDING_FAILED without leaking the item', async () => {
  const fake: VoyageEmbedApi = {
    embed() {
      return Promise.resolve({
        data: [{ index: 0, object: 'embedding' }],
      });
    },
  };
  const client = createVoyageEmbeddingClient(fake);

  try {
    await client.embed(['a'], 'document');
    assert.fail('expected embed to reject');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'EMBEDDING_FAILED');
    const serialised = JSON.stringify(err);
    assert.ok(!serialised.includes('object'));
  }
});
