import assert from 'node:assert/strict';
import { test } from 'node:test';

import { env, loadEnv } from '../../src/config/env.js';

/** A minimally valid source: every required variable set. */
const validSource = {
  VOYAGE_API_KEY: 'test-voyage-key',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
};

test('loadEnv applies all defaults given only the required variables', () => {
  const result = loadEnv(validSource);
  assert.equal(result.PORT, 3001);
  assert.equal(result.NODE_ENV, 'development');
  assert.equal(result.LOG_LEVEL, 'info');
  assert.equal(result.isDevelopment, true);
  assert.equal(result.VOYAGE_EMBEDDING_MODEL, 'voyage-4-lite');
  assert.equal(result.ANTHROPIC_MODEL, 'claude-haiku-4-5-20251001');
});

test('loadEnv({ PORT: "4000" }) overrides PORT with a number', () => {
  const result = loadEnv({ ...validSource, PORT: '4000' });
  assert.equal(result.PORT, 4000);
  assert.equal(typeof result.PORT, 'number');
});

test('loadEnv({ PORT: "" }) treats empty string as unset', () => {
  const result = loadEnv({ ...validSource, PORT: '' });
  assert.equal(result.PORT, 3001);
});

for (const invalid of ['abc', '0', '65536', '3001.5', '-1']) {
  test(`loadEnv rejects invalid PORT "${invalid}"`, () => {
    assert.throws(
      () => loadEnv({ ...validSource, PORT: invalid }),
      /Invalid PORT/,
    );
  });
}

test('loadEnv accepts NODE_ENV "production" and disables isDevelopment', () => {
  const result = loadEnv({ ...validSource, NODE_ENV: 'production' });
  assert.equal(result.NODE_ENV, 'production');
  assert.equal(result.isDevelopment, false);
});

test('loadEnv accepts NODE_ENV "test" and disables isDevelopment', () => {
  const result = loadEnv({ ...validSource, NODE_ENV: 'test' });
  assert.equal(result.NODE_ENV, 'test');
  assert.equal(result.isDevelopment, false);
});

test('loadEnv rejects an invalid NODE_ENV', () => {
  assert.throws(
    () => loadEnv({ ...validSource, NODE_ENV: 'staging' }),
    /Invalid NODE_ENV/,
  );
});

test('loadEnv accepts LOG_LEVEL "silent"', () => {
  const result = loadEnv({ ...validSource, LOG_LEVEL: 'silent' });
  assert.equal(result.LOG_LEVEL, 'silent');
});

test('loadEnv rejects an invalid LOG_LEVEL', () => {
  assert.throws(
    () => loadEnv({ ...validSource, LOG_LEVEL: 'verbose' }),
    /Invalid LOG_LEVEL/,
  );
});

test('loadEnv result is frozen', () => {
  const result = loadEnv(validSource);
  assert.equal(Object.isFrozen(result), true);
});

test('the real env export imports cleanly', () => {
  assert.equal(typeof env.PORT, 'number');
});

test('loadEnv({}) throws: VOYAGE_API_KEY is required', () => {
  assert.throws(() => loadEnv({}), /VOYAGE_API_KEY/);
});

test('loadEnv rejects a blank VOYAGE_API_KEY', () => {
  assert.throws(() => loadEnv({ VOYAGE_API_KEY: '   ' }), /VOYAGE_API_KEY/);
});

test('loadEnv accepts a VOYAGE_API_KEY with surrounding content preserved as-is', () => {
  const result = loadEnv({ ...validSource, VOYAGE_API_KEY: 'sk-voyage-abc123' });
  assert.equal(result.VOYAGE_API_KEY, 'sk-voyage-abc123');
});

test('loadEnv defaults VOYAGE_EMBEDDING_MODEL to voyage-4-lite when unset', () => {
  const result = loadEnv(validSource);
  assert.equal(result.VOYAGE_EMBEDDING_MODEL, 'voyage-4-lite');
});

test('loadEnv defaults VOYAGE_EMBEDDING_MODEL to voyage-4-lite when blank', () => {
  const result = loadEnv({ ...validSource, VOYAGE_EMBEDDING_MODEL: '' });
  assert.equal(result.VOYAGE_EMBEDDING_MODEL, 'voyage-4-lite');
});

test('loadEnv trims and accepts a provided VOYAGE_EMBEDDING_MODEL, with no allow-list', () => {
  const result = loadEnv({
    ...validSource,
    VOYAGE_EMBEDDING_MODEL: '  some-future-model  ',
  });
  assert.equal(result.VOYAGE_EMBEDDING_MODEL, 'some-future-model');
});

test('loadEnv({ VOYAGE_API_KEY }) throws: ANTHROPIC_API_KEY is required', () => {
  assert.throws(
    () => loadEnv({ VOYAGE_API_KEY: 'test-voyage-key' }),
    /ANTHROPIC_API_KEY/,
  );
});

test('loadEnv rejects a blank ANTHROPIC_API_KEY', () => {
  assert.throws(
    () => loadEnv({ ...validSource, ANTHROPIC_API_KEY: '   ' }),
    /ANTHROPIC_API_KEY/,
  );
});

test('loadEnv accepts an ANTHROPIC_API_KEY preserved as-is', () => {
  const result = loadEnv({
    ...validSource,
    ANTHROPIC_API_KEY: 'sk-anthropic-abc123',
  });
  assert.equal(result.ANTHROPIC_API_KEY, 'sk-anthropic-abc123');
});

test('loadEnv defaults ANTHROPIC_MODEL to claude-haiku-4-5-20251001 when unset', () => {
  const result = loadEnv(validSource);
  assert.equal(result.ANTHROPIC_MODEL, 'claude-haiku-4-5-20251001');
});

test('loadEnv rejects a set-but-blank ANTHROPIC_MODEL rather than defaulting it', () => {
  assert.throws(
    () => loadEnv({ ...validSource, ANTHROPIC_MODEL: '   ' }),
    /Invalid ANTHROPIC_MODEL/,
  );
});

test('loadEnv trims and accepts a provided ANTHROPIC_MODEL, with no allow-list', () => {
  const result = loadEnv({
    ...validSource,
    ANTHROPIC_MODEL: '  some-future-model  ',
  });
  assert.equal(result.ANTHROPIC_MODEL, 'some-future-model');
});
