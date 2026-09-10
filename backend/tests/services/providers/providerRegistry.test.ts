import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getChatClient,
  getEmbeddingClient,
} from '../../../src/services/providers/providerRegistry.js';

test('getEmbeddingClient resolves an EmbeddingClient without making a network call', () => {
  const client = getEmbeddingClient('session-1');
  assert.equal(typeof client.embed, 'function');
});

test('getEmbeddingClient accepts an unused session id per client (a different one still resolves fine)', () => {
  const a = getEmbeddingClient('session-a');
  const b = getEmbeddingClient('session-b');
  assert.equal(typeof a.embed, 'function');
  assert.equal(typeof b.embed, 'function');
});

test('getChatClient resolves a ChatClient without making a network call', () => {
  const client = getChatClient('session-1');
  assert.equal(typeof client.streamAnswer, 'function');
});

test('getChatClient accepts an unused session id per client (a different one still resolves fine)', () => {
  const a = getChatClient('session-a');
  const b = getChatClient('session-b');
  assert.equal(typeof a.streamAnswer, 'function');
  assert.equal(typeof b.streamAnswer, 'function');
});
