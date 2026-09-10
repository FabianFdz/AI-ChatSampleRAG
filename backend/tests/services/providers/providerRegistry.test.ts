import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getEmbeddingClient } from '../../../src/services/providers/providerRegistry.js';

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
