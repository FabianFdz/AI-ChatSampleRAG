/**
 * Project-owned types for E3 (RAG engine). This file grows across the
 * sprint's tickets; E3-T01 adds only what the embedding path needs.
 *
 * Plain, JSON-serialisable data, matching E2's `document.types.ts` style —
 * except the embedding vector itself, which never leaves the embedding /
 * vector-index services.
 */

import type { Chunk } from './document.types.js';

/**
 * An E2 `Chunk` paired with its embedding vector. Chunk identity is carried
 * by embedding the whole `Chunk`, not by re-deriving ids from an index.
 */
export interface EmbeddedChunk {
  chunk: Chunk;
  embedding: number[];
}
