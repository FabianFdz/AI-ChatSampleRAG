import assert from 'node:assert/strict';
import { test } from 'node:test';

import { env, loadEnv } from '../../src/config/env.js';

test('loadEnv({}) applies all defaults', () => {
  const result = loadEnv({});
  assert.equal(result.PORT, 3001);
  assert.equal(result.NODE_ENV, 'development');
  assert.equal(result.LOG_LEVEL, 'info');
  assert.equal(result.isDevelopment, true);
});

test('loadEnv({ PORT: "4000" }) overrides PORT with a number', () => {
  const result = loadEnv({ PORT: '4000' });
  assert.equal(result.PORT, 4000);
  assert.equal(typeof result.PORT, 'number');
});

test('loadEnv({ PORT: "" }) treats empty string as unset', () => {
  const result = loadEnv({ PORT: '' });
  assert.equal(result.PORT, 3001);
});

for (const invalid of ['abc', '0', '65536', '3001.5', '-1']) {
  test(`loadEnv rejects invalid PORT "${invalid}"`, () => {
    assert.throws(() => loadEnv({ PORT: invalid }), /Invalid PORT/);
  });
}

test('loadEnv accepts NODE_ENV "production" and disables isDevelopment', () => {
  const result = loadEnv({ NODE_ENV: 'production' });
  assert.equal(result.NODE_ENV, 'production');
  assert.equal(result.isDevelopment, false);
});

test('loadEnv accepts NODE_ENV "test" and disables isDevelopment', () => {
  const result = loadEnv({ NODE_ENV: 'test' });
  assert.equal(result.NODE_ENV, 'test');
  assert.equal(result.isDevelopment, false);
});

test('loadEnv rejects an invalid NODE_ENV', () => {
  assert.throws(() => loadEnv({ NODE_ENV: 'staging' }), /Invalid NODE_ENV/);
});

test('loadEnv accepts LOG_LEVEL "silent"', () => {
  const result = loadEnv({ LOG_LEVEL: 'silent' });
  assert.equal(result.LOG_LEVEL, 'silent');
});

test('loadEnv rejects an invalid LOG_LEVEL', () => {
  assert.throws(() => loadEnv({ LOG_LEVEL: 'verbose' }), /Invalid LOG_LEVEL/);
});

test('loadEnv result is frozen', () => {
  const result = loadEnv({});
  assert.equal(Object.isFrozen(result), true);
});

test('the real env export imports cleanly', () => {
  assert.equal(typeof env.PORT, 'number');
});
