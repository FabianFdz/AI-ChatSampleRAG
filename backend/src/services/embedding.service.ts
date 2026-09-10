/**
 * Chunk-batch and query embedding (E3-T01).
 *
 * `embedChunks`/`embedQuery` are the public, session-id-first entry points
 * other services call — they resolve their `EmbeddingClient` through the
 * provider registry and never construct one themselves (ADR-13, ADR-16).
 * `embedChunksWithClient`/`embedQueryWithClient` hold the actual batching
 * logic against an injected client, so unit tests can exercise it with a
 * fake (ADR-8) without going through the registry or a network call.
 */

import { AppError } from '../errors/AppError.js';
import type { Chunk } from './document.types.js';
import { getEmbeddingClient } from './providers/providerRegistry.js';
import {
  VOYAGE_MAX_CHARS_PER_REQUEST,
  VOYAGE_MAX_INPUTS_PER_REQUEST,
} from './providers/voyageEmbeddingClient.js';
import type { EmbeddingClient } from './providers/ports.js';
import type { EmbeddedChunk } from './rag.types.js';

/**
 * Splits `texts` into ordered batches that each respect the adapter's
 * verified per-request maxima (item count, and a character-based proxy for
 * its token budget), preserving input order across batch boundaries.
 */
function batchTexts(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const text of texts) {
    const wouldExceedCount = current.length >= VOYAGE_MAX_INPUTS_PER_REQUEST;
    const wouldExceedChars =
      currentChars + text.length > VOYAGE_MAX_CHARS_PER_REQUEST;
    if (current.length > 0 && (wouldExceedCount || wouldExceedChars)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(text);
    currentChars += text.length;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

/**
 * Embeds `chunks` against `client`, resolving to one `EmbeddedChunk` per
 * input chunk, same length and order as `chunks`. Batches are awaited
 * **sequentially**, never concurrently: concurrency would multiply spend
 * and defeat a pre-flight budget check (ADR-16), and there is no retry or
 * backoff here — an automatic retry would silently double spend.
 */
export async function embedChunksWithClient(
  client: EmbeddingClient,
  chunks: Chunk[],
): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) {
    return [];
  }

  const texts = chunks.map((chunk) => chunk.text);
  const batches = batchTexts(texts);

  const vectors: number[][] = [];
  for (const batch of batches) {
    const batchVectors = await client.embed(batch, 'document');
    vectors.push(...batchVectors);
  }

  return chunks.map((chunk, index) => {
    const embedding = vectors[index];
    if (!embedding) {
      // Our own batching produced this mismatch; it is a bug here, not a
      // provider response (the adapter already guarantees a same-length,
      // same-order result or throws `EMBEDDING_FAILED`).
      throw AppError.internal(
        `embedChunksWithClient: missing embedding at index ${String(index)} after batching`,
      );
    }
    return { chunk, embedding };
  });
}

/**
 * Embeds `query` against `client`, resolving to a single vector. Uses the
 * same `EmbeddingClient` (and therefore the same model, read once from the
 * env module by the adapter) as the document path, which is what keeps
 * query and chunk vectors comparable.
 */
export async function embedQueryWithClient(
  client: EmbeddingClient,
  query: string,
): Promise<number[]> {
  const [vector] = await client.embed([query], 'query');
  if (!vector) {
    throw AppError.internal(
      'embedQueryWithClient: provider returned no vector for a single-text request',
    );
  }
  return vector;
}

/** Embeds `chunks` for `sessionId`. See `embedChunksWithClient` for the batching contract. */
export async function embedChunks(
  sessionId: string,
  chunks: Chunk[],
): Promise<EmbeddedChunk[]> {
  return embedChunksWithClient(getEmbeddingClient(sessionId), chunks);
}

/** Embeds `query` for `sessionId`, using the same model as `embedChunks`. */
export async function embedQuery(
  sessionId: string,
  query: string,
): Promise<number[]> {
  return embedQueryWithClient(getEmbeddingClient(sessionId), query);
}
