// The compiled LangGraph graph (ADR-14) — the only path to the chat model.
// Two nodes (retrieve, generate), not the epic's four-stage wording:
// formatting/prompt assembly stay as promptBuilder.ts helpers called from
// generate. E3-T04 reuses this same buildRagGraph output for streaming —
// one graph, not a parallel implementation.

import { Annotation, END, START, StateGraph, getWriter } from '@langchain/langgraph';

import { buildMessages, buildSystemPrompt } from './promptBuilder.js';
import { RAG } from './rag.types.js';
import type { RetrievedChunk } from './rag.types.js';
import type { ChatClient } from './providers/ports.js';

const RagGraphState = Annotation.Root({
  question: Annotation<string>,
  retrievedChunks: Annotation<RetrievedChunk[]>({
    reducer: (_current, next) => next,
    default: () => [],
  }),
  answer: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => '',
  }),
});

// The graph's collaborators — already resolved for one session, one call.
export interface RagGraphDependencies {
  embedQuery: (question: string) => Promise<number[]>;
  searchIndex: (queryVector: number[]) => RetrievedChunk[];
  chatClient: ChatClient;
}

export interface RagGraphResult {
  answer: string;
  retrievedChunks: RetrievedChunk[];
}

// Built per call, closing over that call's already-resolved collaborators —
// never a module-level client, so E3-T06's guardrail is a change to what
// chat.service.ts passes in, not to this file.
export function buildRagGraph(deps: RagGraphDependencies) {
  return new StateGraph(RagGraphState)
    .addNode('retrieve', async (state) => {
      const queryVector = await deps.embedQuery(state.question);
      const retrievedChunks = deps.searchIndex(queryVector);
      if (retrievedChunks.length === 0) {
        // Set here, not in generate — the conditional edge below skips generate entirely.
        return { retrievedChunks, answer: RAG.noContextAnswer };
      }
      return { retrievedChunks };
    })
    .addNode('generate', async (state) => {
      const systemPrompt = buildSystemPrompt();
      const messages = buildMessages(state.question, state.retrievedChunks);

      // getWriter() is a no-op sink under invoke, live under stream — no branch needed here.
      const write = getWriter();

      let answer = '';
      for await (const delta of deps.chatClient.streamAnswer(
        systemPrompt,
        messages,
      )) {
        answer += delta;
        write?.(delta);
      }
      return { answer };
    })
    .addEdge(START, 'retrieve')
    .addConditionalEdges('retrieve', (state) =>
      state.retrievedChunks.length > 0 ? 'generate' : END,
    )
    .addEdge('generate', END)
    .compile();
}

// Non-streaming entry point. A collaborator's AppError reaches the caller
// unwrapped (ADR-14) — no error handling added here.
export async function runRagGraph(
  deps: RagGraphDependencies,
  question: string,
): Promise<RagGraphResult> {
  const graph = buildRagGraph(deps);
  const result = await graph.invoke({ question });
  return { answer: result.answer, retrievedChunks: result.retrievedChunks };
}
