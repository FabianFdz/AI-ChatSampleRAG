import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import { logger } from '../utils/logger.js';
import { DOCUMENT_PROCESSING } from './document.types.js';
import type { Chunk, NormalizedDocument } from './document.types.js';

/**
 * Splits a `NormalizedDocument`'s segments into an ordered array of `Chunk`s.
 *
 * Each segment (page, for PDFs; the whole text, for text sources) is split
 * independently via `splitText` so no chunk ever spans two pages (ADR-11).
 * `chunkOverlap` is an upper bound realised at word granularity inside a
 * paragraph — it is commonly 0 across a paragraph (blank-line) boundary
 * (ADR-9). An empty segment contributes no chunks: the splitter returns an
 * empty array for empty input.
 */
export async function chunkDocument(
  document: NormalizedDocument,
): Promise<Chunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: DOCUMENT_PROCESSING.chunkSize,
    chunkOverlap: DOCUMENT_PROCESSING.chunkOverlap,
  });

  const chunks: Chunk[] = [];
  let index = 0;

  for (const segment of document.segments) {
    const pieces = await splitter.splitText(segment.text);
    for (const text of pieces) {
      chunks.push({
        id: `${document.id}#${index}`,
        documentId: document.id,
        index,
        text,
        metadata: {
          source: document.title,
          sourceType: document.sourceType,
          pageNumber: segment.pageNumber,
          uploadedAt: document.uploadedAt,
        },
      });
      index += 1;
    }
  }

  logger.debug(
    { documentId: document.id, chunkCount: chunks.length },
    'chunked document',
  );

  return chunks;
}
