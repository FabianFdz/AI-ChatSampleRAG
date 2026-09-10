# ADR-13: Voyage AI embeddings are called over its REST API with `fetch`, behind our own client port

- **Status:** Accepted
- **Date:** 2026-09-09
- **Sprint / Tickets:** Sprint 3 — E3-T01

## Context
`CLAUDE.md` fixes embeddings on **Voyage AI** (Claude has no embeddings
endpoint; ADR-6's amendment records the switch away from OpenAI). E3-T01 needs
exactly two operations: embed a batch of chunk texts, and embed one query
string with the same model. It also needs the client to be an **injectable
collaborator**, because `node:test` has no module interception (ADR-8) and the
whole embedding path must be unit-testable without a network or an API key.

Three ways to reach Voyage were considered, and the packaging cost of each was
checked against the registry:

| Option | Cost |
|---|---|
| `voyageai@0.4.0` (official SDK) | Depends on `node-fetch@^2` (a fetch polyfill this project does not need — Node 24 has global `fetch`), and declares `@huggingface/transformers@^3.8.0` and `onnxruntime-node` as optional peers for local tokenisation/multimodal features E3 never uses. |
| `@langchain/community@1.1.29` (`VoyageEmbeddings`) | A kitchen-sink package declaring dozens of optional peers (`pg`, `mysql2`, `puppeteer`, `chromadb`, `openai`, `pyodide`, …) to obtain one HTTP call. |
| Direct REST call with global `fetch` | Zero dependencies. |

The endpoint was verified live before this ADR was written:

```
$ curl -i -X POST https://api.voyageai.com/v1/embeddings \
    -H 'Content-Type: application/json' -d '{"input":["hello"], ...}'
HTTP/2 401
{"detail":"Unauthorized"}
```

So the URL, the JSON request/response content type and the error-body shape
(`detail`, a string) are facts, not documentation claims.

## Decision
Call Voyage's `POST https://api.voyageai.com/v1/embeddings` endpoint directly
with Node's global `fetch`, from a single adapter module
(`src/services/providers/voyageEmbeddingClient.ts`), behind a project-owned
**`EmbeddingClient` port** that the embedding service depends on.

- The port has one method — embed a list of texts as either documents or a
  query — and knows nothing about HTTP, Voyage, or sessions. Tests inject a
  fake implementing it (ADR-8); production wiring resolves the real adapter
  through the provider registry (ADR-16), which is also where the usage
  guardrail wraps it.
- The adapter is the **only** module in the repo that mentions Voyage's URL,
  its request body field names, or its response shape. Nothing Voyage-shaped
  crosses back out: a non-2xx response, a transport failure or a malformed body
  all become an `AppError` with code `EMBEDDING_FAILED` (502), with the real
  status and body logged and never returned (ADR-5).
- Requests carry an explicit timeout (`AbortSignal.timeout`) so a hanging
  provider fails the epic's under-3-second criterion loudly instead of hanging
  the caller.
- The model id is read from the typed env module (ADR-3) with a default, so the
  document and query paths provably use the same model — the property the
  comparability of the two vector sets depends on — while remaining tunable
  without a code change.

## Consequences
- **Zero new dependencies for E3-T01.** This is the same call this project's
  precedent already makes: ADR-3 hand-wrote env validation, ADR-8 hand-wrote a
  20-line test server with `fetch` rather than adding `supertest`. A REST call
  behind an interface is smaller than the wrapper that would hide it.
- The adapter owns Voyage's batching limits (maximum inputs and tokens per
  request). Those limits are **verified against Voyage's current docs at ticket
  time** (ADR-6's convention) and expressed as a constant, with the service
  splitting a large chunk list into ordered batches and concatenating results in
  input order. Order preservation is an acceptance criterion, so it is asserted
  by a test, not assumed from the API.
- Voyage's free-tier terms are likewise verified at ticket time rather than
  copied into source, and the model default is chosen to sit on the free tier
  (the cost-consciousness AC). If the free tier moves, the fix is an env value
  and a constant, not a rewrite.
- We do not get retries, backoff or streaming from an SDK. None is required by
  an acceptance criterion; the usage guardrail (ADR-16) is in fact the opposite
  concern — an automatic retry would silently double spend. If retries become
  necessary, add them in the adapter, in one place.
- If Voyage changes its response shape, exactly one module breaks, and its
  unit tests (which assert the adapter's mapping against recorded response
  bodies, not a live call) are where it shows up.

## Alternatives rejected
- **`voyageai` SDK.** Typed clients and future API coverage for free, but it
  pulls `node-fetch@2` into a Node 24 project that has had global `fetch` since
  before E1, and its optional peers point at a machine-learning toolchain
  (`onnxruntime`, `@huggingface/transformers`) that has no place in this PoC.
  Reconsider if Voyage's API surface starts changing under us.
- **`@langchain/community`'s `VoyageEmbeddings`.** It would slot into a
  LangChain vector store neatly — except ADR-12 decided not to use one. Given
  that, it buys nothing but a very large optional-peer surface.
- **Embedding through LangChain's `Embeddings` base class anyway** (writing our
  own subclass). Adds an inheritance relationship to a framework type in order
  to satisfy an interface nothing in E3 consumes, since neither the index
  (ADR-12) nor the graph (ADR-14) takes a LangChain `Embeddings`.
- **A local/offline embedding model.** No API cost at all, but it means a
  hundreds-of-megabytes model download and CPU inference in a PoC, and it
  contradicts `CLAUDE.md`'s explicit Voyage decision.

## Amendment (2026-09-09)
Overruled at human review, before the design PR merged: use the official
**`voyageai` SDK** (`VoyageAIClient`) instead of a hand-rolled `fetch` call,
trading the zero-dependency footprint above for the maintenance signal an
official client gives — version-tracked request/response shapes and
deprecation warnings ahead of a breaking API change, rather than discovering
the change when a production call starts failing. That risk (Voyage changing
its API under us) is exactly what this ADR's own "if Voyage changes its
response shape, exactly one module breaks" consequence was pricing — the
correction is *who* notices first, not whether the adapter stays isolated.

Re-checked against the registry before writing this amendment
(`voyageai@0.4.0`, current latest):

- Its **only real dependency** is `node-fetch@^2.7.0` — a fetch polyfill,
  irrelevant weight next to what it replaces (this project has had global
  `fetch` since before E1). `@huggingface/transformers` and `onnxruntime-node`
  are declared **`optional: true`** in the SDK's own `package.json`
  (`peerDependenciesMeta`), so `pnpm install` does not fetch them and there is
  no `approve-builds` prompt — this ADR's original wording ("optional peers")
  already had that right; it is reaffirmed here because it is the fact that
  makes the SDK's actual cost small.
- `VoyageAIClient.embed()` still returns `data[].embedding` / `data[].index`
  in the same shape this ADR already documented — the sort-by-index and
  count-assertion logic is unaffected.
- **Load-bearing gotcha:** `VoyageAIClient`'s default `maxRetries` is **2**.
  An unconfigured client would retry a failed embed call automatically, which
  is precisely the silent double-spend ADR-16's guardrail exists to prevent
  (ADR-16 charges *before* delegating, once; a hidden retry charges once but
  can cause two provider calls). The adapter **must** construct the client
  with `maxRetries: 0` and pass its own `timeoutInSeconds` (replacing the
  hand-rolled `AbortSignal.timeout`) so both the retry policy and the timeout
  stay explicit, in this ADR's control, rather than the SDK's default.
- The SDK throws its own `VoyageAIError` / `VoyageAITimeoutError` on failure
  in place of a raw `fetch` rejection or a non-2xx response. The adapter
  catches these (not `fetch`-shaped errors) but the outward contract this ADR
  already fixed is unchanged: every failure still becomes `EMBEDDING_FAILED`
  (502) with the real status/body logged and never returned (ADR-5).

Everything else in this ADR's Decision and Consequences stands: one adapter
module is still the only place that knows Voyage exists, the port
(`EmbeddingClient`) is unchanged, and the "Alternatives rejected" section
above is left as the record of what was true when this ADR was first written
— it no longer states the current decision on SDK-vs-`fetch`, only the
reasoning that was superseded.
