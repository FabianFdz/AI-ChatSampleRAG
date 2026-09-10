/**
 * Pure context/prompt-assembly helpers for E3-T03. No I/O, no branching of
 * their own — `ragGraph.service.ts`'s `generate` node calls these rather
 * than the graph having separate "format" / "prompt" nodes for them (ADR-14:
 * two graph nodes, not the epic's four-stage wording).
 */

import type { ChatMessage } from './providers/ports.js';
import type { RetrievedChunk } from './rag.types.js';

const SYSTEM_PROMPT =
  'You are a helpful assistant answering questions about documents the ' +
  "user has uploaded. Answer using only the context below, extracted from " +
  "those documents. If the context does not contain enough information to " +
  'answer, say so plainly rather than guessing or using outside knowledge. ' +
  'Keep answers concise, and refer to "the documents" rather than ' +
  '"the context" or "the chunks".';

/** The fixed system instruction sent on every `generate` call. */
export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

function formatChunk(chunk: RetrievedChunk, position: number): string {
  const pageSuffix =
    chunk.metadata.pageNumber !== null
      ? `, page ${String(chunk.metadata.pageNumber)}`
      : '';
  return `[${String(position)}] Source: ${chunk.metadata.source}${pageSuffix}\n${chunk.text}`;
}

/**
 * Renders `retrievedChunks` as a numbered, source-attributed block, in the
 * order they were retrieved (already ranked by descending score by
 * `searchIndex`).
 */
export function buildContextBlock(retrievedChunks: RetrievedChunk[]): string {
  return retrievedChunks
    .map((chunk, index) => formatChunk(chunk, index + 1))
    .join('\n\n');
}

/**
 * Builds the ordered message list `generate` sends to the chat client:
 * a single user turn carrying the retrieved context followed by the
 * question. T03 is single-turn only — prior conversation turns are E3-T05's
 * concern.
 */
export function buildMessages(
  question: string,
  retrievedChunks: RetrievedChunk[],
): ChatMessage[] {
  const content = `Context:\n${buildContextBlock(retrievedChunks)}\n\nQuestion: ${question}`;
  return [{ role: 'user', content }];
}
