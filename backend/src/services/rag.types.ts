/**
 * Project-owned types for E3 (RAG engine). This file grows across the
 * sprint's tickets; E3-T01 adds only what the embedding path needs, E3-T02
 * adds the session-state / vector-index shapes, and E3-T03 adds the public
 * answer shape.
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
 * A chunk retrieved from a session's vector index, carrying its similarity
 * score. Attribution (`metadata`) survives retrieval intact; formatting it
 * for display is E4/E7's job.
 */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  text: string;
  metadata: ChunkMetadata;
  score: number;
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

// chat.service.ts's public result; sources is empty on the no-context path.
export interface RagAnswer {
  question: string;
  answer: string;
  sources: RetrievedChunk[];
}

/**
 * Frozen RAG tuning constants, mirroring E2's `DOCUMENT_PROCESSING`. This
 * object grows across the sprint's tickets; E3-T02 adds the search knobs and
 * E3-T03 adds the no-context fixed answer.
 */
export const RAG = Object.freeze({
  /** Search returns at most this many results (the AC's number). */
  topK: 3,
  /**
   * Minimum cosine similarity a result must reach to be returned. A
   * starting value for normalised Voyage cosine scores — record the
   * observed on-topic/off-topic spread here once run against the real
   * provider; retuning is one constant (flagged for E8).
   */
  minRelevanceScore: 0.5,
  // Returned when no chunk scores above minRelevanceScore — no LLM call made.
  noContextAnswer:
    "I don't have relevant information in your documents to answer that question.",
});
