/**
 * Validates and renumbers the `Chunk`s produced by `chunkDocument` before
 * they leave the document-processing pipeline.
 *
 * Despite the name, this function does more than "validate": it also filters
 * out empty-text chunks and rebuilds `index`/`id` for the survivors so that,
 * as a guaranteed post-condition, every returned chunk's `index` equals its
 * position in the returned array and its `id` follows the
 * `<documentId>#<index>` convention. Callers downstream (E3, E4) may rely on
 * this without re-checking it themselves.
 */

import {
  chunkValidationError,
  emptyDocumentError,
} from '../errors/documentErrors.js';
import { logger } from '../utils/logger.js';
import type { Chunk } from './document.types.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Throws `chunkValidationError` if `chunk` violates any `Chunk` invariant.
 * Our own chunker produced these chunks, so a violation is a bug, not user
 * input — hence the 500.
 */
function assertValidShape(chunk: Chunk, documentId: string): void {
  const at = `chunk index ${String(chunk.index)}`;

  if (chunk.metadata == null) {
    throw chunkValidationError(`metadata is missing (${at})`);
  }
  if (!isNonEmptyString(chunk.metadata.source)) {
    throw chunkValidationError(`metadata.source is not a non-empty string (${at})`);
  }
  if (!isNonEmptyString(chunk.documentId) || chunk.documentId !== documentId) {
    throw chunkValidationError(
      `documentId is not a non-empty string matching the document id (${at})`,
    );
  }
  if (!isNonNegativeInteger(chunk.index)) {
    throw chunkValidationError(`index is not a non-negative integer (${at})`);
  }
}

/**
 * Validates `chunks` against the `Chunk` invariants, drops empty-text
 * chunks, and returns a new, contiguously-renumbered array. Never mutates
 * `chunks` or its elements.
 *
 * Throws `chunkValidationError` on any invariant violation, and
 * `emptyDocumentError` if zero chunks survive filtering.
 */
export function validateChunks(documentId: string, chunks: Chunk[]): Chunk[] {
  for (const chunk of chunks) {
    assertValidShape(chunk, documentId);
  }

  const survivors = chunks.filter((chunk) => chunk.text.trim() !== '');
  const droppedCount = chunks.length - survivors.length;
  if (droppedCount > 0) {
    logger.warn(
      { documentId, droppedCount },
      'dropped empty-text chunks during validation',
    );
  }

  if (survivors.length === 0) {
    throw emptyDocumentError();
  }

  return survivors.map((chunk, index) => ({
    ...chunk,
    index,
    id: `${documentId}#${index}`,
  }));
}
