// Pure context/prompt-assembly helpers, called from ragGraph.service.ts's
// `generate` node (kept as helpers, not separate graph nodes — ADR-14).

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

// Numbered, source-attributed block, in the order retrieved (already
// ranked by score).
export function buildContextBlock(retrievedChunks: RetrievedChunk[]): string {
  return retrievedChunks
    .map((chunk, index) => formatChunk(chunk, index + 1))
    .join('\n\n');
}

// Single user turn carrying context + question — multi-turn is E3-T05's scope.
export function buildMessages(
  question: string,
  retrievedChunks: RetrievedChunk[],
): ChatMessage[] {
  const content = `Context:\n${buildContextBlock(retrievedChunks)}\n\nQuestion: ${question}`;
  return [{ role: 'user', content }];
}
