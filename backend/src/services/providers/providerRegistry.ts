/**
 * The single construction site for E3's provider clients (ADR-13, ADR-16).
 * Services resolve a client through here rather than constructing one
 * themselves — this file grows across the sprint's tickets; E3-T01 adds the
 * embedding client and E3-T03 adds the chat client.
 */

import { anthropicChatClient } from './anthropicChatClient.js';
import { voyageEmbeddingClient } from './voyageEmbeddingClient.js';
import type { ChatClient, EmbeddingClient } from './ports.js';

/**
 * Returns the embedding client for `sessionId`.
 *
 * `sessionId` is unused in this ticket — it is a deliberate seam for
 * E3-T06, which wraps this return value in a per-session usage-guardrail
 * decorator (ADR-16). Do not remove it and do not treat it as dead code.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- sessionId is an intentional seam for E3-T06 (ADR-16), see doc comment above
export function getEmbeddingClient(sessionId: string): EmbeddingClient {
  return voyageEmbeddingClient();
}

/**
 * Returns the chat client for `sessionId`.
 *
 * `sessionId` is unused in this ticket — same deliberate seam as
 * `getEmbeddingClient` above, for E3-T06's usage-guardrail decorator
 * (ADR-16). Do not remove it and do not treat it as dead code.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- sessionId is an intentional seam for E3-T06 (ADR-16), see doc comment above
export function getChatClient(sessionId: string): ChatClient {
  return anthropicChatClient();
}
