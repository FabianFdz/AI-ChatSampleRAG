import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { AppError } from '../../src/errors/AppError.js';
import {
  processFile,
  processPastedText,
} from '../../src/services/documentPipeline.service.js';

const fixturesDir = new URL('../fixtures/', import.meta.url);

function loadFixture(name: string): Promise<Buffer> {
  return readFile(new URL(name, fixturesDir));
}

async function assertRejectsWithCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(
    promise,
    (err: unknown): boolean => err instanceof AppError && err.code === code,
  );
}

/** A long string of unique, space-separated tokens with no blank lines. */
function buildUniqueTokenText(minLength: number): string {
  const tokens: string[] = [];
  let text = '';
  let i = 0;
  while (text.length < minLength) {
    tokens.push(`w${i.toString().padStart(4, '0')}`);
    text = tokens.join(' ');
    i += 1;
  }
  return text;
}

test('processPastedText: valid pasted text yields clean, contiguous, page-less chunks', async () => {
  const text = buildUniqueTokenText(4800);

  const result = await processPastedText(text);

  assert.equal(result.document.sourceType, 'pasted-text');
  result.chunks.forEach((chunk, position) => {
    assert.equal(chunk.index, position);
    assert.notEqual(chunk.text.trim(), '');
    assert.equal(chunk.metadata.pageNumber, null);
    assert.ok(chunk.text.length <= 1000);
  });
});

test('processPastedText: whitespace-only text rejects with EMPTY_DOCUMENT', async () => {
  await assertRejectsWithCode(processPastedText('   \n\t  '), 'EMPTY_DOCUMENT');
});

test('processFile: sample-3page.pdf yields chunks spanning all three pages, contiguous indexes', async () => {
  const content = new Uint8Array(await loadFixture('sample-3page.pdf'));

  const result = await processFile({ filename: 'sample-3page.pdf', content });

  assert.equal(result.document.pageCount, 3);
  const pageNumbers = new Set(result.chunks.map((chunk) => chunk.metadata.pageNumber));
  assert.deepEqual([...pageNumbers].sort(), [1, 2, 3]);
  result.chunks.forEach((chunk, position) => {
    assert.equal(chunk.index, position);
  });
});

test('processFile: a .txt filename with byte content takes the text path', async () => {
  const content = new TextEncoder().encode('some notes here, plenty of text.');

  const result = await processFile({ filename: 'notes.txt', content });

  assert.equal(result.document.sourceType, 'text-file');
});

test('processFile: a corrupt .pdf body rejects with PDF_PARSE_FAILED as an AppError', async () => {
  const content = new TextEncoder().encode('%PDF-1.4 not a real pdf');

  await assertRejectsWithCode(
    processFile({ filename: 'corrupt.pdf', content }),
    'PDF_PARSE_FAILED',
  );
});

test('processFile: report.docx rejects with UNSUPPORTED_FILE_TYPE before any parsing', async () => {
  const content = new TextEncoder().encode('irrelevant content');

  await assertRejectsWithCode(
    processFile({ filename: 'report.docx', content }),
    'UNSUPPORTED_FILE_TYPE',
  );
});

test('processFile: image.png rejects with UNSUPPORTED_FILE_TYPE before any parsing', async () => {
  const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  await assertRejectsWithCode(
    processFile({ filename: 'image.png', content }),
    'UNSUPPORTED_FILE_TYPE',
  );
});

test('processFile: the extension beats a contradicting MIME type', async () => {
  const content = new TextEncoder().encode('plain text content, not a pdf.');

  const result = await processFile({
    filename: 'notes.txt',
    content,
    mimeType: 'application/pdf',
  });

  assert.equal(result.document.sourceType, 'text-file');
});

test('processFile: a filename with no extension routes from the MIME type alone', async () => {
  const content = new TextEncoder().encode('plain text content, no extension.');

  const result = await processFile({
    filename: 'README',
    content,
    mimeType: 'text/plain',
  });

  assert.equal(result.document.sourceType, 'text-file');
});
