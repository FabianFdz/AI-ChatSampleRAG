import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DOCUMENT_PROCESSING } from '../../src/services/document.types.js';
import { chunkDocument } from '../../src/services/chunking.service.js';
import { buildNormalizedDocument } from '../helpers/documentFixtures.js';

/**
 * Builds a string of `minLength` or more characters made of unique,
 * space-separated tokens (optionally prefixed) with no blank lines — the
 * shape ADR-9 requires for asserting overlap: repeated filler text would
 * make an overlap measurement meaningless.
 */
function buildUniqueTokenText(minLength: number, prefix = 'w'): string {
  const tokens: string[] = [];
  let text = '';
  let i = 0;
  while (text.length < minLength) {
    tokens.push(`${prefix}${i.toString().padStart(4, '0')}`);
    text = tokens.join(' ');
    i += 1;
  }
  return text;
}

/** Overlap (0..maxLen] between the tail of `a` and the head of `b`, or 0. */
function tailHeadOverlap(a: string, b: string, maxLen: number): number {
  const cap = Math.min(a.length, b.length, maxLen);
  for (let len = cap; len > 0; len -= 1) {
    if (a.slice(-len) === b.slice(0, len)) {
      return len;
    }
  }
  return 0;
}

test('multi-chunk document: bounded size, bounded non-zero overlap, no token loss', async () => {
  const text = buildUniqueTokenText(4800);
  const document = buildNormalizedDocument([{ pageNumber: null, text }]);

  const chunks = await chunkDocument(document);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= DOCUMENT_PROCESSING.chunkSize);
  }

  for (let i = 1; i < chunks.length; i += 1) {
    const prev = chunks[i - 1];
    const curr = chunks[i];
    assert.ok(prev);
    assert.ok(curr);
    const overlap = tailHeadOverlap(
      prev.text,
      curr.text,
      DOCUMENT_PROCESSING.chunkOverlap,
    );
    assert.ok(overlap > 0, `expected overlap between chunks ${i - 1} and ${i}`);
    assert.ok(overlap <= DOCUMENT_PROCESSING.chunkOverlap);
  }

  const joined = chunks.map((chunk) => chunk.text).join(' ');
  for (const token of text.split(' ')) {
    assert.ok(joined.includes(token), `missing token ${token}`);
  }
});

test('ordering and attribution', async () => {
  const text = buildUniqueTokenText(4800);
  const document = buildNormalizedDocument([{ pageNumber: null, text }], {
    title: 'attributed-doc.txt',
    uploadedAt: '2026-03-01T12:00:00.000Z',
  });

  const chunks = await chunkDocument(document);

  assert.ok(chunks.length > 1);
  chunks.forEach((chunk, position) => {
    assert.equal(chunk.index, position);
    assert.equal(chunk.documentId, document.id);
    assert.equal(chunk.id, `${document.id}#${position}`);
    assert.equal(chunk.metadata.source, document.title);
    assert.equal(chunk.metadata.uploadedAt, document.uploadedAt);
  });
});

test('page propagation: no chunk spans two pages, indexes stay contiguous in page order', async () => {
  const pageNumbers = [1, 2, 3];
  const markers = pageNumbers.map((pageNumber) => `PAGE${pageNumber}MARKER`);
  const segments = pageNumbers.map((pageNumber, i) => ({
    pageNumber,
    text: `${markers[i]} ${buildUniqueTokenText(1450, `p${pageNumber}_`)}`,
  }));
  const document = buildNormalizedDocument(segments);

  const chunks = await chunkDocument(document);

  const pageNumbersSeen = new Set(chunks.map((chunk) => chunk.metadata.pageNumber));
  assert.deepEqual([...pageNumbersSeen].sort(), [1, 2, 3]);

  for (const chunk of chunks) {
    const containedMarkers = markers.filter((marker) => chunk.text.includes(marker));
    assert.ok(
      containedMarkers.length <= 1,
      `chunk should not contain markers from more than one page: ${chunk.text}`,
    );
    if (containedMarkers.length === 1) {
      const expectedPage = Number(containedMarkers[0]?.match(/PAGE(\d)MARKER/)?.[1]);
      assert.equal(chunk.metadata.pageNumber, expectedPage);
    }
  }

  chunks.forEach((chunk, position) => {
    assert.equal(chunk.index, position);
  });

  // Indexes stay in page order: pageNumber sequence across chunks is
  // non-decreasing.
  let previousPage = 0;
  for (const chunk of chunks) {
    assert.ok(chunk.metadata.pageNumber !== null);
    assert.ok(chunk.metadata.pageNumber >= previousPage);
    previousPage = chunk.metadata.pageNumber;
  }
});

test('text-source documents carry no page number', async () => {
  const text = buildUniqueTokenText(4800);
  const document = buildNormalizedDocument([{ pageNumber: null, text }]);

  const chunks = await chunkDocument(document);

  assert.ok(chunks.length > 0);
  for (const chunk of chunks) {
    assert.equal(chunk.metadata.pageNumber, null);
  }
});

test('short document yields exactly one chunk containing the full text', async () => {
  const text = buildUniqueTokenText(200);
  const document = buildNormalizedDocument([{ pageNumber: null, text }]);

  const chunks = await chunkDocument(document);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.text, text);
  assert.equal(chunks[0]?.index, 0);
});

test('an empty segment contributes zero chunks and the index sequence continues', async () => {
  const firstText = buildUniqueTokenText(200, 'a');
  const thirdText = buildUniqueTokenText(200, 'b');
  const document = buildNormalizedDocument([
    { pageNumber: 1, text: firstText },
    { pageNumber: 2, text: '' },
    { pageNumber: 3, text: thirdText },
  ]);

  const chunks = await chunkDocument(document);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.text, firstText);
  assert.equal(chunks[0]?.index, 0);
  assert.equal(chunks[0]?.metadata.pageNumber, 1);
  assert.equal(chunks[1]?.text, thirdText);
  assert.equal(chunks[1]?.index, 1);
  assert.equal(chunks[1]?.metadata.pageNumber, 3);
});
