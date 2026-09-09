import { randomUUID } from 'node:crypto';

import type {
  DocumentSegment,
  DocumentSourceType,
  NormalizedDocument,
} from '../../src/services/document.types.js';

/**
 * Builds a `NormalizedDocument` from a list of segments, for tests that
 * exercise the chunker (and, later, validation/pipeline tests) without going
 * through `ingestText`/`ingestPdf`. Fields the chunker does not read get
 * sensible defaults; pass `overrides` to pin specific ones.
 */
export function buildNormalizedDocument(
  segments: DocumentSegment[],
  overrides: Partial<NormalizedDocument> = {},
): NormalizedDocument {
  const text = segments.map((segment) => segment.text).join('\n\n');
  const hasPages = segments.some((segment) => segment.pageNumber !== null);
  const sourceType: DocumentSourceType = hasPages ? 'pdf' : 'text-file';

  return {
    id: randomUUID(),
    title: 'test-document',
    sourceType,
    segments,
    text,
    pageCount: hasPages ? segments.length : null,
    charCount: text.length,
    uploadedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
