import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EmbeddingInputKind } from '../../src/services/providers/ports.js';
import {
  embedChunks,
  embedChunksWithClient,
  embedQueryWithClient,
} from '../../src/services/embedding.service.js';
import type { Chunk } from '../../src/services/document.types.js';
import {
  VOYAGE_MAX_INPUTS_PER_REQUEST,
} from '../../src/services/providers/voyageEmbeddingClient.js';

interface RecordedCall {
  texts: string[];
  kind: EmbeddingInputKind;
}

/** A fake `EmbeddingClient` (ADR-8): deterministic, in-memory, no network. */
function fakeClient(recordedCalls: RecordedCall[] = []): {
  embed(texts: string[], kind: EmbeddingInputKind): Promise<number[][]>;
  calls: RecordedCall[];
} {
  return {
    calls: recordedCalls,
    embed(texts, kind) {
      recordedCalls.push({ texts: [...texts], kind });
      return Promise.resolve(texts.map((text) => [text.length, texts.indexOf(text)]));
    },
  };
}

function buildChunk(index: number, text: string): Chunk {
  return {
    id: `doc-1#${index}`,
    documentId: 'doc-1',
    index,
    text,
    metadata: {
      source: 'test.txt',
      sourceType: 'text-file',
      pageNumber: null,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

test('embedChunksWithClient preserves order and identity, pairing each chunk with its own vector', async () => {
  const client = fakeClient();
  const chunks = [buildChunk(0, 'aaa'), buildChunk(1, 'bb'), buildChunk(2, 'c')];

  const result = await embedChunksWithClient(client, chunks);

  assert.equal(result.length, 3);
  result.forEach((embedded, i) => {
    assert.equal(embedded.chunk, chunks[i]);
    assert.deepEqual(embedded.embedding, [chunks[i]!.text.length, i]);
  });
});

test('embedChunksWithClient calls the client with inputType "document"', async () => {
  const client = fakeClient();
  await embedChunksWithClient(client, [buildChunk(0, 'hello')]);

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]!.kind, 'document');
});

test('embedChunksWithClient on an empty chunk list resolves to [] without calling the client', async () => {
  const client = fakeClient();
  const result = await embedChunksWithClient(client, []);

  assert.deepEqual(result, []);
  assert.equal(client.calls.length, 0);
});

test('embedChunksWithClient splits more than VOYAGE_MAX_INPUTS_PER_REQUEST chunks into multiple batches, concatenated in input order', async () => {
  const client = fakeClient();
  const chunkCount = VOYAGE_MAX_INPUTS_PER_REQUEST + 1;
  const chunks = Array.from({ length: chunkCount }, (_, i) => buildChunk(i, `chunk-${i}`));

  const result = await embedChunksWithClient(client, chunks);

  assert.equal(result.length, chunkCount);
  assert.ok(client.calls.length >= 2, 'expected at least two batches');
  assert.equal(
    client.calls.reduce((sum, call) => sum + call.texts.length, 0),
    chunkCount,
  );
  result.forEach((embedded, i) => {
    assert.equal(embedded.chunk, chunks[i]);
  });
  // Order is preserved across the batch boundary.
  const allTexts = client.calls.flatMap((call) => call.texts);
  assert.deepEqual(allTexts, chunks.map((chunk) => chunk.text));
});

test('embedQueryWithClient resolves to a single vector and calls the client with inputType "query"', async () => {
  const client = fakeClient();

  const vector = await embedQueryWithClient(client, 'what about the second one?');

  assert.deepEqual(vector, ['what about the second one?'.length, 0]);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]!.kind, 'query');
  assert.deepEqual(client.calls[0]!.texts, ['what about the second one?']);
});

test('embedQuery and embedChunks resolve through the registry without throwing for an empty/no-op call', async () => {
  // No network call is made here: embedChunks([]) short-circuits before
  // ever reaching the (test-placeholder-keyed) Voyage client.
  const result = await embedChunks('session-1', []);
  assert.deepEqual(result, []);
});
