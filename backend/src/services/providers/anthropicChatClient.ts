/**
 * The only module in the repo that knows `@langchain/anthropic`/Claude
 * exists (ADR-14). Nothing Anthropic-shaped crosses back out: a thrown
 * provider error, and a mid-stream provider throw, both become `LLM_FAILED`
 * (502), with the real cause logged and never returned (ADR-5).
 *
 * `createAnthropicChatClient` takes the chat model as a parameter purely so
 * tests can inject a fake implementing the same one-method shape (ADR-8 — no
 * module mocking). `anthropicChatClient()` is the production singleton the
 * provider registry resolves.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';

import { env } from '../../config/env.js';
import { llmFailedError } from '../../errors/ragErrors.js';
import { logger } from '../../utils/logger.js';
import type { ChatClient, ChatMessage } from './ports.js';

/**
 * Bounds the cost of any single answer — also what caps E3-T06's per-call
 * overshoot, since the guardrail can only budget for a call whose maximum
 * spend is known ahead of time.
 */
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 1024;

/**
 * Explicit, replacing the Anthropic SDK's own defaults (10 minute timeout,
 * 2 retries) for the same reason ADR-13 sets Voyage's explicitly: a hidden
 * retry would silently double-spend, which is exactly what E3-T06's usage
 * guardrail exists to prevent, and an unbounded timeout would hang the
 * caller instead of failing loudly.
 */
const REQUEST_TIMEOUT_MS = 30_000;

type AnthropicMessage = SystemMessage | HumanMessage | AIMessage;

/** The minimal shape this adapter depends on — satisfied by the real `ChatAnthropic` and by test fakes. */
export interface AnthropicChatApi {
  stream(messages: AnthropicMessage[]): Promise<AsyncIterable<{ text: string }>>;
}

function toAnthropicMessages(
  systemPrompt: string,
  messages: ChatMessage[],
): AnthropicMessage[] {
  return [
    new SystemMessage(systemPrompt),
    ...messages.map((message) =>
      message.role === 'user'
        ? new HumanMessage(message.content)
        : new AIMessage(message.content),
    ),
  ];
}

/**
 * Wraps `chatModel` (the real SDK-backed model in production, a fake in
 * tests) as our project-owned `ChatClient` port.
 */
export function createAnthropicChatClient(
  chatModel: AnthropicChatApi,
): ChatClient {
  return {
    async *streamAnswer(
      systemPrompt: string,
      messages: ChatMessage[],
    ): AsyncIterable<string> {
      let stream: AsyncIterable<{ text: string }>;
      try {
        stream = await chatModel.stream(
          toAnthropicMessages(systemPrompt, messages),
        );
      } catch (cause) {
        logger.error({ err: cause }, 'Anthropic chat request failed');
        throw llmFailedError();
      }

      try {
        for await (const chunk of stream) {
          if (chunk.text.length > 0) {
            yield chunk.text;
          }
        }
      } catch (cause) {
        logger.error(
          { err: cause },
          'Anthropic chat stream failed mid-response',
        );
        throw llmFailedError();
      }
    },
  };
}

let realChatModel: ChatAnthropic | undefined;

function getRealChatAnthropic(): ChatAnthropic {
  if (!realChatModel) {
    realChatModel = new ChatAnthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      maxTokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
      clientOptions: {
        // SDK default is 2 — see `REQUEST_TIMEOUT_MS`'s comment above.
        maxRetries: 0,
        timeout: REQUEST_TIMEOUT_MS,
      },
    });
  }
  return realChatModel;
}

/** The production `ChatClient`, resolved by the provider registry. */
export function anthropicChatClient(): ChatClient {
  return createAnthropicChatClient(getRealChatAnthropic());
}
