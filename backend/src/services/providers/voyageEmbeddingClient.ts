/**
 * The only module in the repo that knows Voyage AI exists (ADR-13,
 * amended to use the official `voyageai` SDK's `VoyageAIClient` rather than
 * a hand-rolled `fetch` call). Nothing Voyage-shaped crosses back out: every
 * failure — a thrown `VoyageAIError`/`VoyageAITimeoutError`, or a response
 * whose shape we don't recognise — becomes `EMBEDDING_FAILED` (502), with
 * the real status/body logged and never returned (ADR-5).
 *
 * `createVoyageEmbeddingClient` takes the Voyage SDK client as a parameter
 * purely so tests can inject a fake implementing the same one-method shape
 * (ADR-8 — no module mocking). `voyageEmbeddingClient()` is the production
 * singleton the provider registry resolves.
 */

import type { EmbedRequest, EmbedResponse } from 'voyageai';
import { VoyageAIClient } from 'voyageai';

import { env } from '../../config/env.js';
import { embeddingFailedError } from '../../errors/ragErrors.js';
import { logger } from '../../utils/logger.js';
import type { EmbeddingClient, EmbeddingInputKind } from './ports.js';

/**
 * Voyage's documented per-request maxima
 * (docs.voyageai.com/reference/embeddings-api, verified 2026-09-10): at most
 * 1,000 input strings per request. Token maxima vary per model (1,000,000
 * for `voyage-4-lite`, this module's default model); neither Voyage nor
 * Anthropic reports a token count before a call is made (the same gap
 * ADR-16 hits for its own budgeting), so token pressure here is estimated
 * defensively at ~4 characters per token rather than left unchecked.
 */
export const VOYAGE_MAX_INPUTS_PER_REQUEST = 1000;
export const VOYAGE_MAX_TOKENS_PER_REQUEST = 1_000_000;
export const VOYAGE_APPROX_CHARS_PER_TOKEN = 4;
export const VOYAGE_MAX_CHARS_PER_REQUEST =
  VOYAGE_MAX_TOKENS_PER_REQUEST * VOYAGE_APPROX_CHARS_PER_TOKEN;

/**
 * Explicit per ADR-13's amendment, replacing the SDK's own 60s default so
 * the timeout stays in this module's control rather than the SDK's.
 */
const REQUEST_TIMEOUT_SECONDS = 30;

/** The minimal shape this adapter depends on — satisfied by the real `VoyageAIClient` and by test fakes. */
export interface VoyageEmbedApi {
  embed(request: EmbedRequest): Promise<EmbedResponse>;
}

/**
 * Wraps `voyageClient` (the real SDK client in production, a fake in tests)
 * as our project-owned `EmbeddingClient` port.
 */
export function createVoyageEmbeddingClient(
  voyageClient: VoyageEmbedApi,
): EmbeddingClient {
  return {
    async embed(
      texts: string[],
      kind: EmbeddingInputKind,
    ): Promise<number[][]> {
      let response: EmbedResponse;
      try {
        response = await voyageClient.embed({
          input: texts,
          model: env.VOYAGE_EMBEDDING_MODEL,
          inputType: kind,
        });
      } catch (cause) {
        logger.error({ err: cause }, 'Voyage embedding request failed');
        throw embeddingFailedError();
      }

      const items = response.data;
      if (!Array.isArray(items) || items.length !== texts.length) {
        logger.error(
          {
            model: env.VOYAGE_EMBEDDING_MODEL,
            expectedCount: texts.length,
            receivedCount: items?.length,
          },
          'Voyage embedding response item count did not match input count',
        );
        throw embeddingFailedError();
      }

      // The response's items carry an `index`; map by it rather than
      // trusting positional order (Voyage does not document ordering).
      const vectors: (number[] | undefined)[] = new Array(texts.length);
      for (const item of items) {
        const { index, embedding } = item;
        const indexIsValid =
          typeof index === 'number' &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < texts.length;
        if (!indexIsValid || !Array.isArray(embedding)) {
          logger.error(
            { model: env.VOYAGE_EMBEDDING_MODEL },
            'Voyage embedding response item is malformed',
          );
          throw embeddingFailedError();
        }
        vectors[index] = embedding;
      }

      if (vectors.some((vector) => vector === undefined)) {
        logger.error(
          { model: env.VOYAGE_EMBEDDING_MODEL },
          'Voyage embedding response is missing an index',
        );
        throw embeddingFailedError();
      }

      return vectors as number[][];
    },
  };
}

let realClient: VoyageAIClient | undefined;

function getRealVoyageClient(): VoyageAIClient {
  if (!realClient) {
    realClient = new VoyageAIClient({
      apiKey: env.VOYAGE_API_KEY,
      // SDK default is 2 — a hidden retry would silently double-spend,
      // which is exactly what E3-T06's usage guardrail exists to prevent.
      maxRetries: 0,
      timeoutInSeconds: REQUEST_TIMEOUT_SECONDS,
    });
  }
  return realClient;
}

/** The production `EmbeddingClient`, resolved by the provider registry. */
export function voyageEmbeddingClient(): EmbeddingClient {
  return createVoyageEmbeddingClient(getRealVoyageClient());
}
