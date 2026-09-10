/**
 * Provider ports for E3 (ADR-13, ADR-16). No HTTP, no vendor names, no
 * session awareness — this is the seam every unit test injects a fake into
 * (ADR-8) and the seam E3-T06's usage-guardrail decorator wraps. This file
 * grows across the sprint's tickets; E3-T01 adds only `EmbeddingClient`.
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
