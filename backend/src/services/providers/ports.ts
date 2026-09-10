/**
 * Provider ports for E3 (ADR-13, ADR-16). No HTTP, no vendor names, no
 * session awareness — this is the seam every unit test injects a fake into
 * (ADR-8) and the seam E3-T06's usage-guardrail decorator wraps. This file
 * grows across the sprint's tickets; E3-T01 adds `EmbeddingClient` and
 * E3-T03 adds `ChatClient`.
 */

/** Whether text is being embedded as a retrieval query or as a searchable document. */
export type EmbeddingInputKind = 'document' | 'query';

export interface EmbeddingClient {
  /**
   * Embeds `texts` and resolves to one vector per input text, **in input
   * order** — regardless of what order the underlying provider returns them
   * in.
   */
  embed(texts: string[], kind: EmbeddingInputKind): Promise<number[][]>;
}

/** Who a chat turn's content is attributed to. */
export type ChatMessageRole = 'user' | 'assistant';

/** One role-tagged chat message, project-owned — no LangChain message classes cross this boundary. */
export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ChatClient {
  // No separate non-streaming method: invoke just accumulates this stream,
  // making "same answer either way" structural rather than a hope (ADR-14).
  streamAnswer(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncIterable<string>;
}
