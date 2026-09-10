import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearAllSessionState } from '../../src/services/sessionState.service.js';
import type { EmbeddedChunk } from '../../src/services/rag.types.js';
import {
  indexEmbeddedChunks,
  searchIndex,
} from '../../src/services/vectorIndex.service.js';

test.beforeEach(() => {
  clearAllSessionState();
});

/** A hand-built embedded chunk. `embedding` is not required to be unit-length — normalisation is `vectorIndex.service.ts`'s job. */
function buildEmbeddedChunk(
  chunkId: string,
  embedding: number[],
  documentId = 'doc-1',
): EmbeddedChunk {
  return {
    chunk: {
      id: chunkId,
      documentId,
      index: 0,
      text: `text of ${chunkId}`,
      metadata: {
        source: 'test.txt',
        sourceType: 'text-file',
        pageNumber: null,
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
    },
    embedding,
  };
}

function closeTo(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${String(actual)} to be close to ${String(expected)}`,
  );
}

test('searchIndex ranks by descending known cosine score, capped at RAG.topK, dropping the below-threshold entry', () => {
  // Unit vector [1, 0]; a 3-4-5 vector normalising to [0.8, 0.6]; a 3-4-5
  // vector normalising to [0.6, 0.8]; a vector orthogonal to the query.
  // Query is the unit vector [1, 0], so the dot products are exactly the
  // vectors' own first (x) component after normalisation: 1.0, 0.8, 0.6, 0.0.
  indexEmbeddedChunks('session-1', [
    buildEmbeddedChunk('chunk-a', [1, 0]),
    buildEmbeddedChunk('chunk-b', [4, 3]),
    buildEmbeddedChunk('chunk-c', [3, 4]),
    buildEmbeddedChunk('chunk-d', [0, 1]),
  ]);

  const results = searchIndex('session-1', [1, 0]);

  assert.equal(results.length, 3, 'chunk-d scores 0.0, below the 0.5 threshold, and RAG.topK caps at 3');
  assert.deepEqual(
    results.map((r) => r.chunkId),
    ['chunk-a', 'chunk-b', 'chunk-c'],
  );
  closeTo(results[0]!.score, 1.0);
  closeTo(results[1]!.score, 0.8);
  closeTo(results[2]!.score, 0.6);
});

test('searchIndex carries chunk id, document id, text and metadata through to the result', () => {
  indexEmbeddedChunks('session-1', [buildEmbeddedChunk('chunk-a', [1, 0], 'doc-9')]);

  const [result] = searchIndex('session-1', [1, 0]);

  assert.equal(result!.chunkId, 'chunk-a');
  assert.equal(result!.documentId, 'doc-9');
  assert.equal(result!.text, 'text of chunk-a');
  assert.deepEqual(result!.metadata, {
    source: 'test.txt',
    sourceType: 'text-file',
    pageNumber: null,
    uploadedAt: '2026-01-01T00:00:00.000Z',
  });
});

test('a query scoring below RAG.minRelevanceScore against every entry returns fewer results than topK', () => {
  indexEmbeddedChunks('session-1', [
    buildEmbeddedChunk('chunk-above', [1, 0]),
    buildEmbeddedChunk('chunk-below', [0, 1]),
  ]);

  const results = searchIndex('session-1', [1, 0]);

  assert.equal(results.length, 1);
  assert.equal(results[0]!.chunkId, 'chunk-above');
});

test('an off-topic query scoring below threshold against every entry returns []', () => {
  indexEmbeddedChunks('session-1', [buildEmbeddedChunk('chunk-a', [0, 1])]);

  const results = searchIndex('session-1', [1, 0]);

  assert.deepEqual(results, []);
});

test('searchIndex on an unknown session returns [] without creating a session record', () => {
  assert.deepEqual(searchIndex('never-seen-session', [1, 0]), []);
});

test('indexEmbeddedChunks on an empty array is a no-op that does not allocate a session record', () => {
  indexEmbeddedChunks('session-1', []);
  assert.deepEqual(searchIndex('session-1', [1, 0]), []);
});

test('indexEmbeddedChunks throws EMBEDDING_DIMENSION_MISMATCH when a new vector does not match the session index dimension', () => {
  indexEmbeddedChunks('session-1', [buildEmbeddedChunk('chunk-a', [1, 0])]);

  assert.throws(
    () => indexEmbeddedChunks('session-1', [buildEmbeddedChunk('chunk-b', [1, 0, 0])]),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as { code?: string }).code, 'EMBEDDING_DIMENSION_MISMATCH');
      assert.equal((err as { statusCode?: number }).statusCode, 500);
      return true;
    },
  );
});

test('searchIndex throws EMBEDDING_DIMENSION_MISMATCH when the query vector does not match the session index dimension', () => {
  indexEmbeddedChunks('session-1', [buildEmbeddedChunk('chunk-a', [1, 0])]);

  assert.throws(
    () => searchIndex('session-1', [1, 0, 0]),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as { code?: string }).code, 'EMBEDDING_DIMENSION_MISMATCH');
      return true;
    },
  );
});

test('session A search never returns session B chunks', () => {
  indexEmbeddedChunks('session-a', [buildEmbeddedChunk('chunk-a', [1, 0])]);
  indexEmbeddedChunks('session-b', [buildEmbeddedChunk('chunk-b', [1, 0])]);

  const resultsA = searchIndex('session-a', [1, 0]);
  const resultsB = searchIndex('session-b', [1, 0]);

  assert.deepEqual(resultsA.map((r) => r.chunkId), ['chunk-a']);
  assert.deepEqual(resultsB.map((r) => r.chunkId), ['chunk-b']);
});
