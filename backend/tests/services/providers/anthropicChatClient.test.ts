import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../../../src/errors/AppError.js';
import {
  createAnthropicChatClient,
  type AnthropicChatApi,
} from '../../../src/services/providers/anthropicChatClient.js';
import type { ChatMessage } from '../../../src/services/providers/ports.js';

async function drain(iterable: AsyncIterable<string>): Promise<string[]> {
  const values: string[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

async function assertRejectsWithLlmFailed(
  promise: Promise<unknown>,
): Promise<void> {
  await assert.rejects(promise, (err: unknown): boolean => {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'LLM_FAILED');
    assert.equal(err.statusCode, 502);
    return true;
  });
}

function fakeStreamOf(texts: string[]): AnthropicChatApi {
  return {
    stream() {
      return Promise.resolve(
        (async function* (): AsyncGenerator<{ text: string }> {
          for (const text of texts) {
            yield { text };
          }
        })(),
      );
    },
  };
}

test('maps provider deltas to plain string yields, in order, skipping empty-text chunks', async () => {
  const client = createAnthropicChatClient(fakeStreamOf(['Hel', '', 'lo']));

  const deltas = await drain(client.streamAnswer('be helpful', []));

  assert.deepEqual(deltas, ['Hel', 'lo']);
});

test('sends a system message followed by role-mapped messages, in the given order', async () => {
  let received: { _getType(): string; content: unknown }[] | undefined;
  const fake: AnthropicChatApi = {
    stream(messages) {
      received = messages;
      return Promise.resolve((async function* () {})());
    },
  };
  const client = createAnthropicChatClient(fake);
  const messages: ChatMessage[] = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ];

  await drain(client.streamAnswer('be helpful', messages));

  assert.equal(received?.length, 3);
  assert.equal(received?.[0]?._getType(), 'system');
  assert.equal(received?.[0]?.content, 'be helpful');
  assert.equal(received?.[1]?._getType(), 'human');
  assert.equal(received?.[1]?.content, 'hi');
  assert.equal(received?.[2]?._getType(), 'ai');
  assert.equal(received?.[2]?.content, 'hello');
});

test('a thrown provider error on the initial call surfaces as LLM_FAILED without leaking the cause', async () => {
  const fake: AnthropicChatApi = {
    stream() {
      return Promise.reject(new Error('overloaded_error: try again later'));
    },
  };
  const client = createAnthropicChatClient(fake);

  await assertRejectsWithLlmFailed(drain(client.streamAnswer('system', [])));
});

test('a mid-stream provider throw delivers the deltas already yielded, then surfaces as LLM_FAILED', async () => {
  const fake: AnthropicChatApi = {
    stream() {
      return Promise.resolve(
        (async function* (): AsyncGenerator<{ text: string }> {
          yield { text: 'partial ' };
          yield { text: 'answer' };
          throw new Error('connection reset');
        })(),
      );
    },
  };
  const client = createAnthropicChatClient(fake);

  const seen: string[] = [];
  await assert.rejects(
    (async () => {
      for await (const delta of client.streamAnswer('system', [])) {
        seen.push(delta);
      }
    })(),
    (err: unknown): boolean => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, 'LLM_FAILED');
      return true;
    },
  );
  assert.deepEqual(seen, ['partial ', 'answer']);
});
