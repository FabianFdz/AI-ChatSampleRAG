import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildContextBlock,
  buildMessages,
  buildSystemPrompt,
} from '../../src/services/promptBuilder.js';
import type { RetrievedChunk } from '../../src/services/rag.types.js';

function buildRetrievedChunk(
  text: string,
  overrides: Partial<RetrievedChunk> = {},
): RetrievedChunk {
  return {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    text,
    metadata: {
      source: 'handbook.pdf',
      sourceType: 'pdf',
      pageNumber: 3,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
    score: 0.9,
    ...overrides,
  };
}

test('buildSystemPrompt returns a non-empty, fixed instruction', () => {
  const prompt = buildSystemPrompt();
  assert.equal(typeof prompt, 'string');
  assert.ok(prompt.length > 0);
  assert.equal(prompt, buildSystemPrompt(), 'the system prompt is a fixed constant');
});

test('buildContextBlock includes each chunk\'s text and source attribution', () => {
  const block = buildContextBlock([
    buildRetrievedChunk('The warranty lasts two years.', {
      metadata: {
        source: 'handbook.pdf',
        sourceType: 'pdf',
        pageNumber: 3,
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
    }),
  ]);

  assert.ok(block.includes('The warranty lasts two years.'));
  assert.ok(block.includes('handbook.pdf'));
  assert.ok(block.includes('3'));
});

test('buildContextBlock omits a page suffix for a non-paginated source', () => {
  const block = buildContextBlock([
    buildRetrievedChunk('Pasted text content.', {
      metadata: {
        source: 'pasted-text',
        sourceType: 'pasted-text',
        pageNumber: null,
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
    }),
  ]);

  assert.ok(block.includes('Pasted text content.'));
  assert.ok(!block.includes('page'));
});

test('buildContextBlock renders multiple chunks in the given order', () => {
  const block = buildContextBlock([
    buildRetrievedChunk('first chunk text'),
    buildRetrievedChunk('second chunk text'),
  ]);

  assert.ok(block.indexOf('first chunk text') < block.indexOf('second chunk text'));
});

test('buildMessages returns a single user message carrying both the retrieved text and the question', () => {
  const messages = buildMessages('What is the warranty period?', [
    buildRetrievedChunk('The warranty lasts two years.'),
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.role, 'user');
  assert.ok(messages[0]!.content.includes('The warranty lasts two years.'));
  assert.ok(messages[0]!.content.includes('What is the warranty period?'));
});
