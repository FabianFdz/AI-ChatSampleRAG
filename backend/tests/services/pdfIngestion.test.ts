import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AppError } from '../../src/errors/AppError.js';
import { DOCUMENT_PROCESSING } from '../../src/services/document.types.js';
import { ingestPdf } from '../../src/services/pdfIngestion.service.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

function loadFixture(name: string): Promise<Buffer> {
  return readFile(`${fixturesDir}${name}`);
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

test('sample-3page.pdf yields three page-attributed segments with no cross-page mixing', async () => {
  const content = new Uint8Array(await loadFixture('sample-3page.pdf'));
  const doc = await ingestPdf({ content, filename: 'sample-3page.pdf' });

  assert.equal(doc.pageCount, 3);
  assert.equal(doc.segments.length, 3);
  assert.deepEqual(
    doc.segments.map((segment) => segment.pageNumber),
    [1, 2, 3],
  );

  const markers = ['PAGE-1-MARKER-UNIQUE-TOKEN', 'PAGE-2-MARKER-UNIQUE-TOKEN', 'PAGE-3-MARKER-UNIQUE-TOKEN'];
  doc.segments.forEach((segment, i) => {
    const ownMarker = markers[i];
    assert.ok(ownMarker !== undefined);
    assert.ok(segment.text.includes(ownMarker));
    markers.forEach((marker, j) => {
      if (j !== i) {
        assert.ok(!segment.text.includes(marker));
      }
    });
  });
});

test('no data loss: document text contains all page markers and charCount matches', async () => {
  const content = new Uint8Array(await loadFixture('sample-3page.pdf'));
  const doc = await ingestPdf({ content, filename: 'sample-3page.pdf' });

  assert.ok(doc.text.includes('PAGE-1-MARKER-UNIQUE-TOKEN'));
  assert.ok(doc.text.includes('PAGE-2-MARKER-UNIQUE-TOKEN'));
  assert.ok(doc.text.includes('PAGE-3-MARKER-UNIQUE-TOKEN'));
  assert.equal(doc.charCount, doc.text.length);
});

test('sourceType, title and uploadedAt are set correctly', async () => {
  const content = new Uint8Array(await loadFixture('sample-3page.pdf'));
  const doc = await ingestPdf({ content, filename: 'sample-3page.pdf' });

  assert.equal(doc.sourceType, 'pdf');
  assert.equal(doc.title, 'sample-3page.pdf');

  const roundTripped = new Date(doc.uploadedAt).toISOString();
  assert.equal(roundTripped, doc.uploadedAt);
});

test('corrupt PDF body rejects with PDF_PARSE_FAILED, message hides the library exception name', async () => {
  const content = new TextEncoder().encode('%PDF-1.4 not a real pdf');

  try {
    await ingestPdf({ content, filename: 'corrupt.pdf' });
    assert.fail('expected ingestPdf to reject');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'PDF_PARSE_FAILED');
    assert.equal(err.statusCode, 400);
    assert.ok(!err.message.includes('InvalidPDFException'));
  }
});

test('non-PDF body (ordinary prose) rejects with PDF_PARSE_FAILED', async () => {
  const content = new TextEncoder().encode(
    'This is ordinary prose text, not a PDF file at all.',
  );

  await assertRejectsWithCode(
    ingestPdf({ content, filename: 'notes.pdf' }),
    'PDF_PARSE_FAILED',
  );
});

test('blank.pdf rejects with EMPTY_DOCUMENT', async () => {
  const content = new Uint8Array(await loadFixture('blank.pdf'));

  await assertRejectsWithCode(
    ingestPdf({ content, filename: 'blank.pdf' }),
    'EMPTY_DOCUMENT',
  );
});

test('an over-size buffer rejects with DOCUMENT_TOO_LARGE without invoking the parser', async () => {
  const content = new Uint8Array(DOCUMENT_PROCESSING.maxDocumentBytes + 1);

  await assertRejectsWithCode(
    ingestPdf({ content, filename: 'huge.pdf' }),
    'DOCUMENT_TOO_LARGE',
  );
});

test('extracting sample-3page.pdf finishes in under 2000ms', async () => {
  const content = new Uint8Array(await loadFixture('sample-3page.pdf'));

  const start = performance.now();
  await ingestPdf({ content, filename: 'sample-3page.pdf' });
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 2000, `expected under 2000ms, took ${elapsed}ms`);
});
