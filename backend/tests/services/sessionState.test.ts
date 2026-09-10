import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clearAllSessionState,
  clearSessionState,
  getOrCreateSessionState,
  readSessionState,
} from '../../src/services/sessionState.service.js';

test.beforeEach(() => {
  clearAllSessionState();
});

test('readSessionState returns null for a session never seen, without creating one', () => {
  assert.equal(readSessionState('unknown-session'), null);
  // Reading again must still see nothing — the first read must not have
  // allocated a record (ADR-15).
  assert.equal(readSessionState('unknown-session'), null);
});

test('getOrCreateSessionState creates an empty record on first access', () => {
  const state = getOrCreateSessionState('session-1');
  assert.equal(state.sessionId, 'session-1');
  assert.deepEqual(state.vectorIndex, []);
});

test('getOrCreateSessionState returns the same stored object on subsequent calls', () => {
  const first = getOrCreateSessionState('session-1');
  first.vectorIndex.push({
    chunkId: 'doc-1#0',
    documentId: 'doc-1',
    text: 'hello',
    metadata: {
      source: 'test.txt',
      sourceType: 'text-file',
      pageNumber: null,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
    embedding: [1, 0],
  });

  const second = getOrCreateSessionState('session-1');
  assert.equal(second, first);
  assert.equal(second.vectorIndex.length, 1);
});

test('a get-or-create for one session is invisible to readSessionState for another', () => {
  getOrCreateSessionState('session-a');
  assert.equal(readSessionState('session-b'), null);
});

test('clearSessionState drops the whole record for one session only', () => {
  const a = getOrCreateSessionState('session-a');
  a.vectorIndex.push({
    chunkId: 'doc-1#0',
    documentId: 'doc-1',
    text: 'hello',
    metadata: {
      source: 'test.txt',
      sourceType: 'text-file',
      pageNumber: null,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
    embedding: [1, 0],
  });
  getOrCreateSessionState('session-b');

  clearSessionState('session-a');

  assert.equal(readSessionState('session-a'), null);
  assert.notEqual(readSessionState('session-b'), null);
});

test('clearAllSessionState resets every session', () => {
  getOrCreateSessionState('session-a');
  getOrCreateSessionState('session-b');

  clearAllSessionState();

  assert.equal(readSessionState('session-a'), null);
  assert.equal(readSessionState('session-b'), null);
});
