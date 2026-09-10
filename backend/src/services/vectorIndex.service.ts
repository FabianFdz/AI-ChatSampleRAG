/**
 * Per-session vector index and brute-force semantic search (ADR-12, E3-T02).
 *
 * A plain array inside each session's `SessionState` record, scored by a
 * dot product over unit-normalised vectors (measured 0.07ms at 30 vectors —
 * ADR-12 — against a 595MB LanceDB dependency). There is exactly one index
 * per session and no global index, which is what makes cross-session leakage
 * structurally impossible rather than a filter somebody could forget:
 * `indexEmbeddedChunks` and `searchIndex` only ever touch the one session's
 * record resolved through `sessionState.service.ts`.
 */

import { AppError } from '../errors/AppError.js';
import { embeddingDimensionMismatchError } from '../errors/ragErrors.js';
import { logger } from '../utils/logger.js';
import { RAG } from './rag.types.js';
import type {
  EmbeddedChunk,
  RetrievedChunk,
  VectorIndexEntry,
} from './rag.types.js';
import {
  getOrCreateSessionState,
  readSessionState,
} from './sessionState.service.js';

/**
 * Normalises `vector` to unit length. Voyage's returned vectors are not
 * trusted to already be unit vectors — normalisation happens defensively,
 * in this one place, for both insert and query paths.
 *
 * A zero-magnitude vector is a provider bug (there is nothing to divide by
 * to get a meaningful direction), so this throws rather than returning a
 * vector of `NaN`s or dividing by zero.
 */
function normalize(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) {
    sumOfSquares += value * value;
  }
  const magnitude = Math.sqrt(sumOfSquares);
  if (magnitude === 0) {
    throw AppError.internal(
      'vectorIndex: cannot normalise a zero-magnitude embedding vector',
    );
  }
  return vector.map((value) => value / magnitude);
}

/** Dot product of two equal-length vectors. Cosine similarity when both are unit vectors. */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/**
 * Throws `embeddingDimensionMismatchError` if `dimension` doesn't match
 * `expectedDimension`. A mismatch means a model changed mid-session — our
 * own bug, not user input. The actual dimensions are logged server-side
 * only; they do not belong in the client-facing error (ADR-5, ADR-13).
 */
function assertDimension(expectedDimension: number, dimension: number): void {
  if (dimension !== expectedDimension) {
    logger.error(
      { expectedDimension, actualDimension: dimension },
      'vectorIndex: embedding vector dimension does not match session index',
    );
    throw embeddingDimensionMismatchError();
  }
}

/**
 * Indexes `embeddedChunks` into `sessionId`'s vector index, normalising each
 * embedding to unit length at insert time. A no-op for an empty input (does
 * not allocate a session record just to index nothing).
 *
 * Every vector — the ones already in the session's index and every vector in
 * this call — must share the same dimension; a mismatch throws
 * `EMBEDDING_DIMENSION_MISMATCH`.
 */
export function indexEmbeddedChunks(
  sessionId: string,
  embeddedChunks: EmbeddedChunk[],
): void {
  if (embeddedChunks.length === 0) {
    return;
  }

  const state = getOrCreateSessionState(sessionId);
  const expectedDimension =
    state.vectorIndex[0]?.embedding.length ??
    embeddedChunks[0]!.embedding.length;

  const newEntries: VectorIndexEntry[] = embeddedChunks.map(
    ({ chunk, embedding }) => {
      assertDimension(expectedDimension, embedding.length);
      return {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        text: chunk.text,
        metadata: chunk.metadata,
        embedding: normalize(embedding),
      };
    },
  );

  state.vectorIndex.push(...newEntries);
}

/**
 * Searches `sessionId`'s vector index for the chunks most similar to
 * `queryVector`, returning at most `RAG.topK` results ordered by descending
 * score, after dropping everything scoring below `RAG.minRelevanceScore`. An
 * off-topic query legitimately returns fewer than `topK` results, or zero.
 *
 * **Never allocates** a session record for an unknown session id — an
 * unknown or empty session simply returns `[]` (ADR-15).
 */
export function searchIndex(
  sessionId: string,
  queryVector: number[],
): RetrievedChunk[] {
  const state = readSessionState(sessionId);
  if (!state || state.vectorIndex.length === 0) {
    return [];
  }

  const expectedDimension = state.vectorIndex[0]!.embedding.length;
  assertDimension(expectedDimension, queryVector.length);
  const normalizedQuery = normalize(queryVector);

  return state.vectorIndex
    .map(
      (entry): RetrievedChunk => ({
        chunkId: entry.chunkId,
        documentId: entry.documentId,
        text: entry.text,
        metadata: entry.metadata,
        score: dotProduct(normalizedQuery, entry.embedding),
      }),
    )
    .filter((result) => result.score >= RAG.minRelevanceScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, RAG.topK);
}
