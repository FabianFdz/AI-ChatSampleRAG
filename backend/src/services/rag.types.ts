/**
 * Project-owned types for E3 (RAG engine). This file grows across the
 * sprint's tickets; E3-T01 adds only what the embedding path needs and
 * E3-T02 adds the session-state / vector-index shapes.
 *
 * Plain, JSON-serialisable data, matching E2's `document.types.ts` style —
 * except the embedding vectors themselves, which never leave the embedding /
 * vector-index services.
 */

import type { Chunk, ChunkMetadata } from './document.types.js';

/**
 * An E2 `Chunk` paired with its embedding vector. Chunk identity is carried
 * by embedding the whole `Chunk`, not by re-deriving ids from an index.
 */
export interface EmbeddedChunk {
  chunk: Chunk;
  embedding: number[];
}

/**
 * One chunk stored inside a session's vector index (E3-T02). `embedding` is
 * normalised to unit length at insert time (ADR-12) and never leaves this
 * layer — `searchIndex` returns `RetrievedChunk`s, never `VectorIndexEntry`s.
 */
export interface VectorIndexEntry {
  chunkId: string;
  documentId: string;
  text: string;
  metadata: ChunkMetadata;
  embedding: number[];
}

/**
 * Per-session state (ADR-15). **One** record per session id, holding every
 * per-session concern E3 has — so a session clear is one operation that
 * cannot leave any of them out of sync. This type grows across the sprint's
 * tickets: E3-T02 adds `vectorIndex`; E3-T05 adds chat history and E3-T06
 * adds usage budgets to this same record.
 */
export interface SessionState {
  sessionId: string;
  vectorIndex: VectorIndexEntry[];
}
