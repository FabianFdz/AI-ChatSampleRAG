/**
 * The compiled LangGraph graph (ADR-14, E3-T03) — the **only** path to the
 * chat model. One `StateGraph` with two nodes, `retrieve` and `generate`,
 * and a conditional edge out of `retrieve`: straight to `END` (the fixed
 * no-context answer, no LLM call at all) when zero chunks score above
 * `RAG.minRelevanceScore`, otherwise to `generate`. Formatting and prompt
 * assembly are pure helpers in `promptBuilder.ts` called from `generate` —
 * not separate graph nodes (ADR-14: two nodes, not the epic's four-stage
 * wording).
 *
 * `buildRagGraph` takes its collaborators (`embedQuery`, `searchIndex`,
 * `chatClient`) as parameters purely so tests can inject fakes (ADR-8 — no
 * module mocking) and build/run a real graph against them. `runRagGraph` is
 * the non-streaming entry point `chat.service.ts` calls, already resolved
 * through the provider registry for a session. E3-T04 reuses the same
 * `buildRagGraph` output for the streaming entry point — this is the "one
 * graph" ADR-14 requires, not a parallel implementation.
 */

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

/** The graph's collaborators — already resolved for one session, one call. */
export interface RagGraphDependencies {
  /** Embeds the retrieval query. Session-scoped and model-selected by the caller. */
  embedQuery: (question: string) => Promise<number[]>;
  /** Searches the session's vector index against an already-embedded query vector. */
  searchIndex: (queryVector: number[]) => RetrievedChunk[];
  chatClient: ChatClient;
}

export interface RagGraphResult {
  answer: string;
  retrievedChunks: RetrievedChunk[];
}

/**
 * Builds and compiles the graph against `deps`. Called once per
 * `answerQuestion` (or streaming, in E3-T04) invocation, closing over that
 * call's already-resolved collaborators — never a module-level provider
 * client, so E3-T06's per-session guardrail decorator is a change to what
 * `chat.service.ts` passes in here, not to this file.
 */
export function buildRagGraph(deps: RagGraphDependencies) {
  return new StateGraph(RagGraphState)
    .addNode('retrieve', async (state) => {
      const queryVector = await deps.embedQuery(state.question);
      const retrievedChunks = deps.searchIndex(queryVector);
      if (retrievedChunks.length === 0) {
        // No LLM call on this path — the fixed answer is set here, not in
        // `generate`, because the conditional edge below routes straight to
        // END and `generate` never runs.
        return { retrievedChunks, answer: RAG.noContextAnswer };
      }
      return { retrievedChunks };
    })
    .addNode('generate', async (state) => {
      const systemPrompt = buildSystemPrompt();
      const messages = buildMessages(state.question, state.retrievedChunks);

      // `getWriter()` is a live function under both `stream` and `invoke`
      // (a no-op sink under `invoke`, ADR-14) — this node needs no branch
      // and no knowledge of how it is being consumed.
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

/**
 * Runs the graph with `invoke` and reads the answer off the final state —
 * the non-streaming entry point. An `AppError` thrown by any collaborator
 * (a failed embed, a failed chat call) reaches the caller unwrapped
 * (verified in ADR-14); this function adds no error handling of its own.
 */
export async function runRagGraph(
  deps: RagGraphDependencies,
  question: string,
): Promise<RagGraphResult> {
  const graph = buildRagGraph(deps);
  const result = await graph.invoke({ question });
  return { answer: result.answer, retrievedChunks: result.retrievedChunks };
}
