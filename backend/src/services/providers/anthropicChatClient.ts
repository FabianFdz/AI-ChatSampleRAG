// The only module that knows @langchain/anthropic exists. Provider errors
// (initial or mid-stream) map to LLM_FAILED, never leaking the raw cause.

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

// Bounds the cost of any single answer.
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 1024;

// Explicit, replacing the SDK's defaults (10min timeout, 2 retries) — a
// hidden retry would silently double-spend against E3-T06's usage guardrail.
const REQUEST_TIMEOUT_MS = 30_000;

type AnthropicMessage = SystemMessage | HumanMessage | AIMessage;

// The minimal shape this adapter depends on — satisfied by ChatAnthropic and test fakes.
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

// Wraps chatModel (real in production, a fake in tests) as our ChatClient port.
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
