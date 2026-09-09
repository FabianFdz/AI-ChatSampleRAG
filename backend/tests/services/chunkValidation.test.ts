import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../../src/errors/AppError.js';
import { validateChunks } from '../../src/services/chunkValidation.service.js';
import type { Chunk } from '../../src/services/document.types.js';

const DOCUMENT_ID = 'doc-1';

function buildChunk(index: number, text: string, overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: `${DOCUMENT_ID}#${index}`,
    documentId: DOCUMENT_ID,
    index,
    text,
    metadata: {
      source: 'test-document',
      sourceType: 'pasted-text',
      pageNumber: null,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

function assertIsChunkValidationError(fn: () => unknown, problemIncludes: string): void {
  try {
    fn();
    assert.fail('expected validateChunks to throw');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'CHUNK_VALIDATION_FAILED');
    assert.equal(err.statusCode, 500);
    const details = err.details as { problem?: string } | undefined;
    assert.ok(details?.problem !== undefined);
    assert.ok(
      details.problem.includes(problemIncludes),
      `expected problem to mention "${problemIncludes}", got "${details.problem}"`,
    );
  }
}

test('empty and whitespace-only chunks are dropped and survivors renumbered', () => {
  const chunks = [
    buildChunk(0, 'first'),
    buildChunk(1, ''),
    buildChunk(2, '   \n\t  '),
    buildChunk(3, 'fourth'),
  ];

  const result = validateChunks(DOCUMENT_ID, chunks);

  assert.equal(result.length, 2);
  assert.equal(result[0]?.text, 'first');
  assert.equal(result[0]?.index, 0);
  assert.equal(result[0]?.id, `${DOCUMENT_ID}#0`);
  assert.equal(result[1]?.text, 'fourth');
  assert.equal(result[1]?.index, 1);
  assert.equal(result[1]?.id, `${DOCUMENT_ID}#1`);
});

test('the input array and its elements are not mutated', () => {
  const chunks = [
    buildChunk(0, 'first'),
    buildChunk(1, ''),
    buildChunk(2, '   '),
    buildChunk(3, 'fourth'),
  ];
  const originalIndexes = chunks.map((chunk) => chunk.index);

  validateChunks(DOCUMENT_ID, chunks);

  assert.equal(chunks.length, 4);
  assert.deepEqual(
    chunks.map((chunk) => chunk.index),
    originalIndexes,
  );
});

test('invalid metadata: empty metadata.source throws', () => {
  const chunks = [
    buildChunk(0, 'text', {
      metadata: {
        source: '',
        sourceType: 'pasted-text',
        pageNumber: null,
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
    }),
  ];
  assertIsChunkValidationError(() => validateChunks(DOCUMENT_ID, chunks), 'source');
});

test('invalid metadata: metadata absent throws', () => {
  const malformed = { ...buildChunk(0, 'text') } as Partial<Chunk>;
  delete malformed.metadata;
  const chunks = [malformed as Chunk];
  assertIsChunkValidationError(() => validateChunks(DOCUMENT_ID, chunks), 'metadata');
});

test('invalid metadata: empty documentId throws', () => {
  const chunks = [buildChunk(0, 'text', { documentId: '' })];
  assertIsChunkValidationError(() => validateChunks(DOCUMENT_ID, chunks), 'documentId');
});

test('invalid metadata: documentId disagreeing with the argument throws', () => {
  const chunks = [buildChunk(0, 'text', { documentId: 'some-other-doc' })];
  assertIsChunkValidationError(() => validateChunks(DOCUMENT_ID, chunks), 'documentId');
});

test('invalid metadata: negative index throws', () => {
  const chunks = [buildChunk(-1, 'text')];
  assertIsChunkValidationError(() => validateChunks(DOCUMENT_ID, chunks), 'index');
});

test('invalid metadata: fractional index throws', () => {
  const chunks = [buildChunk(0.5, 'text')];
  assertIsChunkValidationError(() => validateChunks(DOCUMENT_ID, chunks), 'index');
});

test('a valid list passes through unchanged', () => {
  const chunks = [buildChunk(0, 'first'), buildChunk(1, 'second')];

  const result = validateChunks(DOCUMENT_ID, chunks);

  assert.deepEqual(result, chunks);
});

test('an empty input list throws EMPTY_DOCUMENT', () => {
  try {
    validateChunks(DOCUMENT_ID, []);
    assert.fail('expected validateChunks to throw');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'EMPTY_DOCUMENT');
  }
});

test('a list where every chunk is filtered out throws EMPTY_DOCUMENT', () => {
  const chunks = [buildChunk(0, ''), buildChunk(1, '   ')];
  try {
    validateChunks(DOCUMENT_ID, chunks);
    assert.fail('expected validateChunks to throw');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'EMPTY_DOCUMENT');
  }
});
