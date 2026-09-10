/**
 * Public entry points for E3's answer generation (E3-T03). `answerQuestion`
 * is the non-streaming path other services (E4) call — session-id-first,
 * resolving both provider clients through the registry (never constructing
 * one) and running them through the one compiled LangGraph graph
 * (`ragGraph.service.ts`, ADR-14).
 *
 * Retrieval query construction and prompt history beyond the current
 * question are out of scope here — E3-T05 adds multi-turn conversation
 * strategy. T03 is single-turn: embed the question as the query, search the
 * session's vector index, build a grounded prompt (or return the fixed
 * no-context answer), call the LLM once.
 */

import { embedQueryWithClient } from './embedding.service.js';
import { getChatClient, getEmbeddingClient } from './providers/providerRegistry.js';
import { runRagGraph } from './ragGraph.service.js';
import type { RagAnswer } from './rag.types.js';
import { searchIndex } from './vectorIndex.service.js';

/**
 * Answers `question` for `sessionId`: embeds it as a query, searches the
 * session's vector index, and — through the graph — either returns the
 * fixed no-context answer (no LLM call) or a grounded answer from a single
 * LLM call. `sources` mirrors the chunks the answer was grounded in, empty
 * on the no-context path.
 */
export async function answerQuestion(
  sessionId: string,
  question: string,
): Promise<RagAnswer> {
  const embeddingClient = getEmbeddingClient(sessionId);
  const chatClient = getChatClient(sessionId);

  const { answer, retrievedChunks } = await runRagGraph(
    {
      embedQuery: (q) => embedQueryWithClient(embeddingClient, q),
      searchIndex: (queryVector) => searchIndex(sessionId, queryVector),
      chatClient,
    },
    question,
  );

  return {
    question,
    answer,
    sources: retrievedChunks,
  };
}
