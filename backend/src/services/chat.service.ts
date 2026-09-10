// Public entry points for E3's answer generation. Single-turn only —
// multi-turn prompt history is E3-T05's scope.

import { embedQueryWithClient } from './embedding.service.js';
import { getChatClient, getEmbeddingClient } from './providers/providerRegistry.js';
import { runRagGraph } from './ragGraph.service.js';
import type { RagAnswer } from './rag.types.js';
import { searchIndex } from './vectorIndex.service.js';

// `sources` mirrors the chunks the answer was grounded in, empty on the
// no-context path.
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
