import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../../src/errors/AppError.js';

function assertCommonShape(err: AppError): void {
  assert.equal(err.isOperational, true);
  assert.equal(err.name, 'AppError');
  assert.ok(err instanceof Error);
  assert.equal(typeof err.stack, 'string');
}

test('AppError.badRequest sets statusCode 400 and code BAD_REQUEST', () => {
  const err = AppError.badRequest('bad thing', { field: 'x' });
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'BAD_REQUEST');
  assert.equal(err.message, 'bad thing');
  assert.deepEqual(err.details, { field: 'x' });
  assertCommonShape(err);
});

test('AppError.badRequest leaves details undefined unless passed', () => {
  const err = AppError.badRequest('bad thing');
  assert.equal(err.details, undefined);
});

test('AppError.notFound sets statusCode 404 and code NOT_FOUND', () => {
  const err = AppError.notFound('nope');
  assert.equal(err.statusCode, 404);
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.message, 'nope');
  assert.equal(err.details, undefined);
  assertCommonShape(err);
});

test('AppError.internal sets statusCode 500 and code INTERNAL_ERROR', () => {
  const err = AppError.internal('boom');
  assert.equal(err.statusCode, 500);
  assert.equal(err.code, 'INTERNAL_ERROR');
  assert.equal(err.message, 'boom');
  assert.equal(err.details, undefined);
  assertCommonShape(err);
});
