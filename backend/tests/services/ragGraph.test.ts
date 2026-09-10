import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../../src/errors/AppError.js';
import { embeddingFailedError, llmFailedError } from '../../src/errors/ragErrors.js';
import type { ChatMessage } from '../../src/services/providers/ports.js';
import {
  runRagGraph,
  type RagGraphDependencies,
} from '../../src/services/ragGraph.service.js';
import { RAG, type RetrievedChunk } from '../../src/services/rag.types.js';

function buildRetrievedChunk(text: string, chunkId = 'chunk-1'): RetrievedChunk {
  return {
    chunkId,
    documentId: 'doc-1',
    text,
    metadata: {
      source: 'handbook.pdf',
      sourceType: 'pdf',
      pageNumber: 1,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
    score: 0.9,
  };
}

/** A fake `ChatClient` (ADR-8): deterministic, in-memory, no network. */
function fakeChatClient(deltas: string[]): {
  streamAnswer(systemPrompt: string, messages: ChatMessage[]): AsyncIterable<string>;
  calls: { systemPrompt: string; messages: ChatMessage[] }[];
} {
  const calls: { systemPrompt: string; messages: ChatMessage[] }[] = [];
  return {
    calls,
    streamAnswer(systemPrompt, messages) {
      calls.push({ systemPrompt, messages });
      return (async function* (): AsyncGenerator<string> {
        for (const delta of deltas) {
          yield delta;
        }
      })();
    },
  };
}

function buildDeps(
  overrides: Partial<RagGraphDependencies>,
): RagGraphDependencies {
  return {
    embedQuery: () => Promise.resolve([1, 0]),
    searchIndex: () => [],
    chatClient: fakeChatClient(['ignored']),
    ...overrides,
  };
}

test('an answer grounded in injected context: the retrieved text reaches the prompt and the accumulated deltas are returned', async () => {
  const retrievedChunks = [buildRetrievedChunk('The warranty lasts two years.')];
  const chatClient = fakeChatClient(['The ', 'warranty ', 'lasts two years.']);
  const deps = buildDeps({
    searchIndex: () => retrievedChunks,
    chatClient,
  });

  const result = await runRagGraph(deps, 'What is the warranty period?');

  assert.equal(result.answer, 'The warranty lasts two years.');
  assert.deepEqual(result.retrievedChunks, retrievedChunks);
  assert.equal(chatClient.calls.length, 1);
  assert.ok(
    chatClient.calls[0]!.messages.some((m) =>
      m.content.includes('The warranty lasts two years.'),
    ),
    'the retrieved chunk text must actually reach the prompt sent to the chat client',
  );
});

test('the no-relevant-chunks path returns the fixed answer and never invokes the chat client (anti-fabrication)', async () => {
  const chatClient = fakeChatClient(['should never be seen']);
  const deps = buildDeps({
    searchIndex: () => [],
    chatClient,
  });

  const result = await runRagGraph(deps, 'something off-topic');

  assert.equal(result.answer, RAG.noContextAnswer);
  assert.deepEqual(result.retrievedChunks, []);
  assert.equal(chatClient.calls.length, 0, 'the chat client must never be called on the no-context path');
});

test('a chat provider failure surfaces unwrapped as LLM_FAILED', async () => {
  const deps = buildDeps({
    searchIndex: () => [buildRetrievedChunk('some context')],
    chatClient: {
      streamAnswer() {
        // Deliberately throws before yielding, per ADR-8's fake-collaborator pattern.
        return (async function* (): AsyncGenerator<string> {
          throw llmFailedError();
        })();
      },
    },
  });

  await assert.rejects(runRagGraph(deps, 'a question'), (err: unknown): boolean => {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'LLM_FAILED');
    assert.equal(err.statusCode, 502);
    return true;
  });
});

test('an embedding failure surfaces unwrapped as EMBEDDING_FAILED, and the chat client is never called', async () => {
  const chatClient = fakeChatClient(['should never be seen']);
  const deps = buildDeps({
    embedQuery: () => Promise.reject(embeddingFailedError()),
    chatClient,
  });

  await assert.rejects(runRagGraph(deps, 'a question'), (err: unknown): boolean => {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'EMBEDDING_FAILED');
    assert.equal(err.statusCode, 502);
    return true;
  });
  assert.equal(chatClient.calls.length, 0);
});
