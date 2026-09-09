import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../../src/errors/AppError.js';
import { DOCUMENT_PROCESSING } from '../../src/services/document.types.js';
import {
  ingestText,
  normalizeText,
} from '../../src/services/textIngestion.service.js';

function assertIsAppError(fn: () => unknown, code: string): void {
  assert.throws(
    fn,
    (err: unknown): boolean =>
      err instanceof AppError && err.code === code,
  );
}

test('pasted string input yields a normalized pasted-text document', () => {
  const doc = ingestText({ content: 'hello world' });

  assert.equal(doc.sourceType, 'pasted-text');
  assert.equal(doc.title, 'pasted-text');
  assert.equal(doc.pageCount, null);
  assert.equal(doc.segments.length, 1);
  assert.equal(doc.segments[0]?.pageNumber, null);
  assert.equal(doc.segments[0]?.text, doc.text);
  assert.equal(doc.charCount, doc.text.length);
  assert.equal(doc.text, 'hello world');
});

test('byte-array input with a filename yields a text-file document', () => {
  const bytes = new TextEncoder().encode('some notes here');
  const doc = ingestText({ content: bytes, filename: 'notes.txt' });

  assert.equal(doc.sourceType, 'text-file');
  assert.equal(doc.title, 'notes.txt');
  assert.equal(doc.text, 'some notes here');
});

test('uploadedAt round-trips through Date parsing', () => {
  const doc = ingestText({ content: 'hello world' });
  const roundTripped = new Date(doc.uploadedAt).toISOString();
  assert.equal(roundTripped, doc.uploadedAt);
});

test('id is a non-empty string and differs between calls', () => {
  const first = ingestText({ content: 'hello world' });
  const second = ingestText({ content: 'hello world' });

  assert.equal(typeof first.id, 'string');
  assert.ok(first.id.length > 0);
  assert.notEqual(first.id, second.id);
});

test('empty-input rejection: empty string', () => {
  assertIsAppError(() => ingestText({ content: '' }), 'EMPTY_DOCUMENT');
});

test('empty-input rejection: spaces only', () => {
  assertIsAppError(() => ingestText({ content: '    ' }), 'EMPTY_DOCUMENT');
});

test('empty-input rejection: mix of newlines/tabs/CR', () => {
  assertIsAppError(
    () => ingestText({ content: '\n\t\r\n \r' }),
    'EMPTY_DOCUMENT',
  );
});

test('empty-input rejection: empty byte array', () => {
  assertIsAppError(
    () => ingestText({ content: new Uint8Array(0) }),
    'EMPTY_DOCUMENT',
  );
});

test('normalizeText converts CRLF and bare CR to LF', () => {
  assert.equal(normalizeText('a\r\nb\rc'), 'a\nb\nc');
});

test('normalizeText strips a leading byte-order mark', () => {
  assert.equal(normalizeText('﻿hello'), 'hello');
});

test('normalizeText trims leading/trailing blank lines but keeps interior ones', () => {
  const input = '\n\nfirst\n\nsecond\n\n';
  assert.equal(normalizeText(input), 'first\n\nsecond');
});

test('normalizeText preserves already-trimmed, LF-only text exactly', () => {
  const input = 'line one\n\nline two';
  assert.equal(normalizeText(input), input);
});

test('a document exactly at maxDocumentBytes succeeds', () => {
  const content = 'a'.repeat(DOCUMENT_PROCESSING.maxDocumentBytes);
  const doc = ingestText({ content });
  assert.equal(doc.charCount, DOCUMENT_PROCESSING.maxDocumentBytes);
});

test('a document one byte over maxDocumentBytes is rejected', () => {
  const content = 'a'.repeat(DOCUMENT_PROCESSING.maxDocumentBytes + 1);
  assertIsAppError(() => ingestText({ content }), 'DOCUMENT_TOO_LARGE');
});

test('a multi-byte string under the char cap but over the byte cap is rejected', () => {
  // 'é' is 2 bytes in UTF-8 but 1 character, so a string of
  // maxDocumentBytes/2 + 1 such characters has fewer characters than the
  // cap, yet more bytes than the cap — this is the assertion that catches a
  // String.length-based implementation.
  const charCount = DOCUMENT_PROCESSING.maxDocumentBytes / 2 + 1;
  const content = 'é'.repeat(charCount);
  assert.ok(content.length < DOCUMENT_PROCESSING.maxDocumentBytes);
  assertIsAppError(() => ingestText({ content }), 'DOCUMENT_TOO_LARGE');
});
