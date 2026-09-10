/**
 * Error vocabulary for E3 (RAG engine). Mirrors `documentErrors.ts`: one
 * factory per error the outside world can see, so the code vocabulary can't
 * drift across services. This file grows across the sprint's tickets;
 * E3-T01 adds the embedding-path error and E3-T02 adds the vector-index one.
 */

import { AppError } from './AppError.js';

/**
 * A Voyage embedding call failed outright, timed out, or returned a body
 * whose shape we don't recognise. The real provider status/body is logged by
 * the caller before this is thrown; nothing Voyage-shaped is carried in
 * `details` (ADR-5, ADR-13).
 */
export function embeddingFailedError(): AppError {
  return new AppError(
    502,
    'EMBEDDING_FAILED',
    'Embedding request failed.',
  );
}

/**
 * A vector being indexed or searched does not share the rest of the
 * session's vector index dimension. This is our own bug (a model changed
 * mid-session), not user input, hence the 500 (ADR-12).
 */
export function embeddingDimensionMismatchError(
  expectedDimension: number,
  actualDimension: number,
): AppError {
  return new AppError(
    500,
    'EMBEDDING_DIMENSION_MISMATCH',
    "Embedding vector dimension does not match this session's index.",
    { expectedDimension, actualDimension },
  );
}
