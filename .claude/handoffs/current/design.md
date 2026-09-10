# Sprint 3 Design — tickets E3-T01, E3-T02, E3-T03, E3-T04, E3-T05, E3-T06

Epic E3 — RAG Engine (LangChain + LangGraph).

Five ADRs back this design and are the "why" behind everything below. Read them
before coding; this file is the "how".

| ADR | Decision |
|---|---|
| ADR-12 | Session vector search is brute-force cosine over a plain array, **not LanceDB** |
| ADR-13 | Voyage embeddings via its REST API with global `fetch`, behind our own port |
| ADR-14 | **One** LangGraph graph serves both streaming and non-streaming; sliding-window history |
| ADR-15 | E3 owns **one** in-memory session-state registry; E4 layers HTTP on it |
| ADR-16 | The usage guardrail is a **decorator on the provider ports**, budgeted in calls + characters |

Standing conventions this sprint inherits and must not re-litigate: ADR-3
(typed env module, fail fast at import), ADR-5 (single `AppError` envelope,
`SCREAMING_SNAKE_CASE` codes, internals never echoed), ADR-8 (`node:test` +
`node:assert/strict`, no module mocking — **collaborators are injected**),
ADR-9 (project-owned types at the boundary, no `langchain` meta-package),
sprint-1's layering rule (services are framework-free: no `express`, no
`req`/`res`).

## Tickets in Scope
E3-T01, E3-T02, E3-T03, E3-T04, E3-T05, E3-T06 — in that order. T01/T02 are the
producer pair, T03 consumes them, T04/T05 extend T03, T06 retrofits the
guardrail across every paid call site. One PR per ticket.

---

## Technical Approach

### Module map (all paths under `backend/`)

New in this sprint:

| Module | Ticket | Role |
|---|---|---|
| `src/services/rag.types.ts` | T01 | Project-owned E3 types + the frozen `RAG` tuning constants and `USAGE_LIMITS` object |
| `src/errors/ragErrors.ts` | T01 | E3's error-factory vocabulary, mirroring `documentErrors.ts` |
| `src/services/providers/ports.ts` | T01 | The two provider port interfaces (embedding, chat) — no HTTP, no vendor names |
| `src/services/providers/voyageEmbeddingClient.ts` | T01 | Voyage REST adapter |
| `src/services/providers/providerRegistry.ts` | T01 | The **single** construction site for provider clients |
| `src/services/embedding.service.ts` | T01 | Chunk-batch and query embedding |
| `src/services/sessionState.service.ts` | T02 | The one session-keyed registry (ADR-15) |
| `src/services/vectorIndex.service.ts` | T02 | Per-session index + brute-force search |
| `src/services/providers/anthropicChatClient.ts` | T03 | Claude adapter via `@langchain/anthropic` |
| `src/services/promptBuilder.ts` | T03 | Pure context/prompt assembly helpers |
| `src/services/ragGraph.service.ts` | T03 | The compiled LangGraph graph |
| `src/services/chat.service.ts` | T03 | Public entry points (`answerQuestion`, later stream + history) |
| `src/services/usage.service.ts` | T06 | Budget accounting + the read-only usage snapshot |
| `src/services/providers/governedClients.ts` | T06 | The two guardrail decorators |

Modified: `src/config/env.ts` (T01, T03), `backend/.env.example` (T01, T03),
`backend/package.json` (T01 test script + T03 dependencies).

Tests mirror `src/` under `backend/tests/services/`, per ADR-8.

**ESM reminder (this repo bites here):** the backend is `"type": "module"`.
Every relative import must carry the `.js` extension even from a `.ts` source.
`pnpm dev` (tsx) forgives an omission; `pnpm build && pnpm start` does not.

---

### E3-T01 — Chunk & Query Embedding (Voyage AI)

**The port.** `ports.ts` declares an `EmbeddingClient` interface with a single
method that takes an array of texts plus an input-kind discriminator with the
two values `document` and `query`, and resolves to an array of number arrays —
one vector per input text, in input order. The port mentions no HTTP, no
Voyage, no session. This is the seam every unit test injects a fake into
(ADR-8) and the seam T06 decorates (ADR-16).

**The adapter** (`voyageEmbeddingClient.ts`) is the only module in the repo
that knows Voyage exists. Per ADR-13 it posts to Voyage's `/v1/embeddings`
endpoint with global `fetch`, bearer auth from the env module, an explicit
`AbortSignal.timeout`, and maps the input-kind discriminator onto Voyage's
document/query input-type field. Verify against Voyage's current docs at
implementation time (ADR-6's convention): the exact request field names, the
current model id to use as the default, the maximum inputs and maximum tokens
per request, and the free-tier terms. Encode the per-request maxima as named
constants in this module. Nothing Voyage-shaped crosses back out — a non-2xx
response, a transport throw, or a response whose shape does not match all
become `EMBEDDING_FAILED` (502) with the real status and body logged, never
returned (ADR-5). Voyage returns embeddings with an index field; sort or map by
it rather than trusting positional order, then assert the count matches the
input count.

**Batching.** The service splits a chunk list into ordered batches respecting
the adapter's verified maxima, awaits them **sequentially** (concurrency would
multiply spend and defeat pre-flight budget checks — ADR-16), and concatenates
results in input order. No retries and no backoff: an automatic retry silently
doubles spend, which is the exact thing T06 exists to prevent.

**The service** (`embedding.service.ts`) exposes two functions, both taking the
session id as their first parameter and resolving their client through the
registry (never constructing one):
- embed a `Chunk[]` (E2's type) → an `EmbeddedChunk[]`, same length, same
  order, each pairing the original chunk with its vector. Chunk identity is
  preserved by carrying the whole chunk, not by re-deriving ids.
- embed a query string → one vector, using the **same model** as the document
  path. Comparability of query and chunk vectors depends on this, so the model
  id is read once from the env module rather than passed in per call.

**The registry** (`providerRegistry.ts`) exposes one function per client kind,
each taking a session id and returning a port instance. In this ticket the
session id is **unused** — it is the named seam ADR-16 requires so that T06 is
a two-line change. A reviewer must not flag it as dead code.

**Env (ADR-3 pattern, extend `loadEnv`, do not read `process.env` inline):**
- `VOYAGE_API_KEY` — **required**. Absent or empty throws at import, so the
  process dies at startup rather than on the first upload.
- `VOYAGE_EMBEDDING_MODEL` — optional. Unset or empty → the default constant.
  A provided value is trimmed and accepted; there is no allow-list (it would
  go stale). Validation is non-empty-after-trim only.

**Required-key fallout — handle it in this ticket, it is not optional.**
`env.ts` validates at import time and `app.test.ts` reaches it transitively
(`app.ts` → `routes/index.ts` → `config/env.ts`). The moment `VOYAGE_API_KEY`
becomes required, `pnpm test` fails everywhere with a config error. Fix it by
adding placeholder values to the `test` script in `backend/package.json`
alongside the existing `NODE_ENV=test LOG_LEVEL=silent`, so validation stays
byte-identical across environments and no `NODE_ENV`-conditional branch enters
`env.ts`. `dotenv` never overrides an already-set variable, so a developer's
real `.env` cannot leak into the test run. Add both variables to
`.env.example`, which ADR-3 treats as the committed contract.

**Tests:** batch embedding preserves order and identity with an injected fake
client; multi-batch splitting concatenates in input order; query embedding uses
the same model as the document path; an adapter failure surfaces as
`EMBEDDING_FAILED` rather than an empty array or a crash; the adapter maps a
recorded non-2xx body and a malformed success body to the same typed error
without leaking the provider body.

---

### E3-T02 — Session Vector Index & Semantic Search

**The session registry arrives here** (ADR-15). `sessionState.service.ts` holds
one module-level map from session id to a single `SessionState` record, and
exposes: get-or-create the record, read it without creating it, clear one
session, and clear everything (a test affordance — the singleton must be
resettable between tests). It is framework-free and it owns **all** per-session
concerns E3 has, so a session clear is one operation that cannot leave the
index, the history and the usage counters out of sync. **Reads never allocate:**
a query about an unknown session returns a well-defined empty answer without
creating a record, so an unauthenticated caller cannot grow the map by
inventing ids. E3 has no notion of a session being valid and never produces a
404 — an unknown session behaves as an empty one. Lifecycle is E4's.

**The index** (`vectorIndex.service.ts`) is a plain array inside that record,
searched by brute force (ADR-12 — measured 0.07 ms at 30 vectors, against a
595 MB LanceDB dependency; the epic's LanceDB line is superseded).

- Vectors are normalised to unit length **once at insert time**, and the query
  vector once at search time, so scoring is a plain dot product and cosine
  similarity falls straight out. Normalise defensively in our own code; do not
  assume Voyage returns unit vectors. A zero-magnitude vector is a provider bug
  — reject it rather than dividing by zero.
- Every vector in a session must share the others' dimension. A mismatch is our
  bug (a model changed mid-session), not user input, so it throws
  `EMBEDDING_DIMENSION_MISMATCH` (500).
- Search returns at most `RAG.topK` results, ordered by descending score, after
  dropping everything scoring below `RAG.minRelevanceScore`. An off-topic query
  legitimately returns fewer than three, or zero — that is the behaviour T03's
  no-context branch depends on.
- Each result carries the chunk id, document id, text, the full `ChunkMetadata`
  from E2 (source title, page number) and the score. Attribution must survive
  retrieval intact; formatting it for display is E4/E7's job.
- There is exactly one index per session and no global index, which is what
  makes cross-session leakage structurally impossible rather than a filter
  somebody could forget.

**Tuning constants** (frozen `RAG` object in `rag.types.ts`, mirroring E2's
`DOCUMENT_PROCESSING`): `topK` = 3 (the AC's number).
`minRelevanceScore` = 0.5 — a starting value for normalised Voyage cosine
scores, where unrelated text typically lands well below related text. Record
the observed on-topic/off-topic spread in a comment when first run against the
real provider; retuning is one constant, and it is flagged for E8.

**Tests** use hand-built unit vectors with known dot products (scoring is
dependency-free and deterministic, so no fake provider is needed): indexing
then retrieving top-3 in the right order; a query below threshold returning
fewer or zero; a dimension mismatch throwing; and session A's index never
returning session B's chunks.

---

### E3-T03 — RAG Answer Generation (LangGraph + Claude)

Adds `@langchain/langgraph@^1.4.14` and `@langchain/anthropic@^1.5.9` (peers
verified against the `@langchain/core@^1.2.9` ADR-9 pinned; `zod` is already
present transitively and resolved without a peer warning). **Do not add the
`langchain` meta-package** (ADR-9).

**The chat port.** `ports.ts` gains a `ChatClient` interface with one method:
take the prompt (a system instruction plus an ordered list of role-tagged
messages) and return an **async iterable of text deltas**. There is no separate
non-streaming method. This is deliberate and load-bearing: a single provider
primitive is what makes E3-T04's "the stream concatenates to the same answer as
the non-streaming call" a structural property rather than a hope. The
non-streaming path is accumulation over the same iterable.

**The adapter** (`anthropicChatClient.ts`) wraps `ChatAnthropic` from
`@langchain/anthropic`, configured with the model id and API key from the env
module and an explicit maximum output tokens (which is also what bounds T06's
overshoot). It maps provider deltas to plain strings and maps any provider
throw to `LLM_FAILED` (502), logging the real cause. It is the only module that
imports `@langchain/anthropic`.

**The graph** (`ragGraph.service.ts`), per ADR-14: one compiled `StateGraph`
with two nodes — `retrieve` and `generate` — and a conditional edge out of
`retrieve` that goes to `generate` when relevant chunks were found and straight
to the end when none were. Two nodes, not the epic's four-stage wording:
formatting and prompt assembly are pure functions with no I/O and no branching,
so they stay as testable helpers in `promptBuilder.ts` called from `generate`.
**A reviewer must not fail this ticket for having two nodes instead of four.**

- `retrieve` embeds the query (T01) and searches the session index (T02).
- `generate` obtains the writer from LangGraph's `getWriter()`, iterates the
  chat client's delta iterable, writes one event per delta, accumulates the
  full text, and returns the accumulated answer as its state update. Verified
  in ADR-14: the writer is a live function under `invoke` too (a no-op sink),
  so this node needs **no branch** and no knowledge of how it is consumed.
- The non-streaming entry point runs the compiled graph with `invoke` and reads
  the answer off the final state.

**The no-context short circuit.** When retrieval returns zero chunks above
threshold, the graph **does not call the LLM at all** and the answer is a fixed
"no relevant information in your documents" message from the constants object.
This satisfies "never fabricate" at its strongest — the model is never given
the chance — it is deterministic to test, and it spends nothing.

**Errors survive the graph unwrapped.** ADR-14 verified that an `AppError`
thrown inside a node reaches the caller as the same class with the same
properties, on both `invoke` and `stream`. So ADR-5's envelope needs no
LangGraph-specific handling in E4.

**The public entry point** lives in `chat.service.ts`: given a session id and a
question, resolve to a result carrying the question, the answer text, and the
retrieved chunks' attribution metadata as sources (empty on the no-context
path). One result, tied to the question that produced it.

**Env additions:**
- `ANTHROPIC_API_KEY` — **required**, same fail-at-startup treatment as
  `VOYAGE_API_KEY` (and the same test-script placeholder).
- `ANTHROPIC_MODEL` — optional, defaulting to the cheapest Claude tier
  (**Haiku**, per `CLAUDE.md`'s cost decision). Verify the exact current Haiku
  model id against Anthropic's docs at implementation time and use it as the
  default constant — do not carry one forward from memory or a tutorial.
  Asymmetry with the two keys, and it is intentional: **unset falls back to the
  default; a provided-but-blank value fails fast.** No allow-list validation.

**Latency.** The under-3s budget is roughly a query-embedding hop plus a Claude
round-trip; search is ~0.1 ms (ADR-12) and is not the bottleneck. Both adapters
carry explicit timeouts so a hanging provider fails loudly rather than hanging
the caller.

**Tests** (chat client injected as a fake iterable per ADR-8): an answer
grounded in injected context, asserting the retrieved text actually reaches the
prompt; the no-relevant-chunks path returning the fixed message **and never
invoking the chat client** (assert the fake was not called — that is the
anti-fabrication guarantee); a provider failure surfacing as `LLM_FAILED`.

---

### E3-T04 — Streaming Answer Output

No new provider work and no second implementation — ADR-14 rejects a parallel
streaming path explicitly, because that is how "same final answer" becomes a
test that passes today and drifts next sprint.

`chat.service.ts` gains a streaming entry point that runs the **same compiled
graph** with `streamMode: 'custom'` and yields our own small, JSON-serialisable
event shape (not LangChain's message-chunk types, which would leak into E4's
SSE layer and E7's UI):

- a **token** event per delta, carrying the text fragment;
- one terminal **done** event, carrying the complete answer text and the
  sources — the same values the non-streaming path returns.

**The terminal event is the completion contract.** A stream that ends without
it was truncated. E4's SSE mapping and E7's UI both inherit this.

A mid-stream provider failure propagates out of the async iterator as an
`AppError` (verified: already-written events are delivered, then the iterator
throws). The consumer therefore sees a clear error rather than a partial answer
presented as complete. Never swallow it and emit a `done` event with what was
accumulated so far.

**Tests:** consuming the stream to completion concatenates to exactly the same
string the non-streaming path returns for the same question and injected
context (assert both paths in one test, against one fake, so drift fails the
build); a fake that yields two deltas then throws causes the iterator to throw
after delivering those two deltas, with no `done` event emitted.

---

### E3-T05 — Multi-turn Chat History & Context

**Storage.** The `SessionState` record (ADR-15) gains an ordered array of chat
turns, each a plain JSON-serialisable object with a role (`user` or
`assistant`), the content, and an ISO-8601 UTC timestamp — matching E2's
plain-data style so E4 can return it from a route unmapped. History is retained
**in full** for the life of the session and discarded only by an explicit
session clear, never silently trimmed. Retrieval returns a copy in
chronological order so a caller cannot mutate stored state.

**Write ordering matters.** Append the user turn and the assistant turn
**together, only after a successful answer**. A failed call must not leave a
dangling user turn, and — on the streaming path — must not persist a truncated
assistant answer. The stream appends on the terminal event, not per delta.

**Two distinct uses of history, per ADR-14 — do not collapse them.**
1. *Retrieval query*: the text sent for query embedding is the current question
   preceded by the last `RAG.retrievalHistoryTurns` **user** messages, joined
   as plain text. This is what lets "what about the second one?" retrieve
   anything at all, and it costs nothing beyond the query embedding that was
   already happening.
2. *Prompt history*: the prompt carries a fixed-size sliding window of the most
   recent `RAG.historyWindowMessages` messages, then further truncated to
   `RAG.historyCharBudget` characters, dropping **oldest first**. The window
   bounds the prompt by construction, so "a long conversation still answers" is
   a property of the design rather than something to hope for.

Nothing is summarised, condensed, or rewritten by a second LLM call — that is
out of the plan's scope and doubles per-message spend in the sprint whose
companion ticket exists to cap spend.

**Dropping old turns from the prompt never drops them from stored history.**
The window is a prompt-construction concern only. Keep these two facts in
separate functions so a future reader cannot confuse them.

Suggested constants: `retrievalHistoryTurns` = 2, `historyWindowMessages` = 10,
`historyCharBudget` = 6000. These are the two knobs ADR-14 names as the
graceful-degradation trade; a question referring forty turns back may lose its
referent, and that is accepted against an unbounded prompt.

**Tests:** a follow-up whose answer requires the prior turn resolves correctly
(assert the prior turn reaches both the retrieval query text and the prompt);
history returns chronologically ordered turns; a long simulated conversation
(well past the window) still produces an answer, and the assembled prompt stays
within both the message-count and character bounds; a failed answer leaves
history unchanged.

---

### E3-T06 — Per-Session Usage Guardrail

This ticket resolves sprint 1's deferred rate-limiting flag ("revisit when the
key is live in E3 — an unauthenticated PoC endpoint that spends money per
request is the point where this stops being premature"). ADR-16 has the full
reasoning; the shape is fixed by it.

**Enforcement is a decorator on the provider ports, installed in the registry.**
`governedClients.ts` provides one decorator per port — same interface in, same
interface out — that charges the session's budget, refuses when it is
exhausted, and otherwise delegates. `providerRegistry.ts` wraps its two return
values in them. **That is the whole production diff: one new module, one new
service, and two return statements. T01, T03 and T04 are not touched.** There
is no ungoverned path because there is no other way to obtain a client; adding
one becomes a visible, reviewable act. The session id parameter those tickets
threaded through the registry starts being used here.

**Two budgets, each with two dimensions.** One budget for embeddings, one for
the LLM. Each is measured in **calls** (provider requests made) and **units**
(the character count of text sent, plus for the LLM the characters generated).
A budget is exhausted when **either** dimension reaches its limit — the call
dimension catches many small requests, the unit dimension catches a few large
ones, which is precisely the AC's "many small requests hit the same cap a few
large ones would". Characters, not tokens, deliberately: neither provider
reports a token count *before* the call, which is when the block must happen,
and `js-tiktoken` (bundled with `@langchain/core`) is OpenAI's tokenizer and
would give a confidently wrong number for both providers.

**Charge before, top up after.** Read the budget; throw if already exhausted;
charge one call plus the input's characters; delegate; add generated output
characters on completion. On a mid-stream or mid-call failure, charge the
output produced so far — the provider still bills it. Consequently the
**final** call of a session may overshoot by at most one call's input and
output; that is accepted and bounded by E2's 10 MB document cap on the
embedding side and by the chat adapter's configured maximum output tokens on
the LLM side. The alternative is estimating output length before generating it.

**"Limit reached" is an `AppError`** with code `USAGE_LIMIT_REACHED` and HTTP
status **429**, carrying which budget was exhausted plus the usage snapshot in
`details`. It reuses ADR-5's single envelope, so E4 needs no new plumbing and
E7 branches on `code` — no parallel `Result` channel (sprint 2 argued this out
already).

**The usage snapshot** (`usage.service.ts`) is a pure read: per budget, the
calls and units used, their limits, and a remaining fraction in [0, 1] computed
as the **minimum** of the two dimensions' remaining fractions, so the figure
never overstates what is left; plus an overall remaining fraction that is the
minimum across both budgets. It is data only — no percentage string, no
formatting (E4/E7's job) — safe to call at any point including before the cap
is reached, never triggers a provider call, and never allocates state for an
unknown session (ADR-15), which returns a fresh full-budget snapshot.

**The limits** live in a frozen `USAGE_LIMITS` object beside the other E3
constants, **not** in env config: the plan leaves the numbers to implementation
time and no AC asks for runtime tunability. Derive them from this stated worst
case for "normal exploratory usage" and record the arithmetic in a comment:
three documents of ~50k characters each (~150k characters, a few dozen batched
embedding calls), plus ~50 questions at ~500 characters each, each question
costing one LLM call of roughly 10k input characters (3 retrieved chunks +
history window + question) and ~2k output. Apply at least a 2× margin.
Recommended starting values: embedding — 200 calls / 1,000,000 units; LLM —
60 calls / 1,500,000 units. Adjust only with the arithmetic written down.

Counters live in the session-state record, so a session clear resets the
budgets. For a PoC that is intended (a clear is a fresh trial); real quota
enforcement needs identity this PoC does not have.

**Tests — and note the trap.** Because every other E3 test injects a fake
client directly (ADR-8), they all bypass the decorator. So this ticket must
test the decorator **and** assert that `providerRegistry` actually returns a
governed client — otherwise the guardrail is enforced only in production, which
is the one place nobody is watching. Cover: usage accumulating across multiple
calls within a session; a call blocked with `USAGE_LIMIT_REACHED` once either
dimension is reached, asserting the underlying fake was **not** invoked
(pre-flight blocking); per-session isolation; the remaining fraction changing
correctly as calls are made, including its minimum-of-dimensions behaviour; a
mid-call failure still charging the output produced so far.

---

## Data / Schema Changes

No database (`CLAUDE.md`: in-memory PoC). "Schema" here means the project-owned
types in `rag.types.ts` and the shape of the session-state record. All of it is
plain, JSON-serialisable data — E2's `document.types.ts` style — except the
vector arrays, which are internal to the index and never returned from a public
function. LangChain's `Document` type (whose `metadata` is
`Record<string, any>`) stays out of our types entirely; convert at the adapter
boundary if ever needed.

**New types** (`src/services/rag.types.ts`):

| Type | Shape |
|---|---|
| `EmbeddedChunk` | E2's `Chunk` paired with its embedding vector |
| `RetrievedChunk` | chunk id, document id, text, E2's `ChunkMetadata`, and the similarity score |
| `ChatTurn` | role (`user` \| `assistant`), content, ISO-8601 UTC timestamp |
| `RagAnswer` | the question, the answer text, and the source attributions |
| `AnswerStreamEvent` | a discriminated union: a token event carrying a text fragment, and a terminal done event carrying the full answer and its sources |
| `UsageBudgetSnapshot` | calls used, call limit, units used, unit limit, remaining fraction |
| `UsageSnapshot` | the embedding budget, the LLM budget, and an overall remaining fraction |
| `SessionState` | the session id, the vector index entries, the chat-turn array, and the two usage budgets |

**New constants:** frozen `RAG` (`topK` 3, `minRelevanceScore` 0.5,
`retrievalHistoryTurns` 2, `historyWindowMessages` 10, `historyCharBudget`
6000, the fixed no-context answer text) and frozen `USAGE_LIMITS` (see T06).

**Session state store:** one module-level map from session id to one
`SessionState`, in `sessionState.service.ts`. Process memory only — a restart
loses everything, by design. **No TTL and no eviction:** the map holds one
record per session id ever seen, for the process's lifetime. Acceptable for a
single-user PoC; flagged below for E4/E8.

**New env variables** (`src/config/env.ts` + `.env.example`): `VOYAGE_API_KEY`
(required), `ANTHROPIC_API_KEY` (required), `VOYAGE_EMBEDDING_MODEL` (optional,
defaults), `ANTHROPIC_MODEL` (optional, defaults to Haiku).

**New error codes** (`src/errors/ragErrors.ts`): `EMBEDDING_FAILED` (502),
`EMBEDDING_DIMENSION_MISMATCH` (500), `LLM_FAILED` (502),
`USAGE_LIMIT_REACHED` (429).

## API / Interface Changes

**No HTTP routes.** Endpoint wiring is E4's scope; nothing in this sprint
touches `src/routes/` or `src/app.ts`. The "interfaces" E3 ships are
service-layer function contracts, all framework-free, all session-id-first:

- **Embedding** — embed a chunk list for a session (returns one embedded chunk
  per input chunk, same order); embed a query string for a session (returns one
  vector).
- **Vector index** — index a session's embedded chunks; search a session with a
  query vector (returns at most `RAG.topK` retrieved chunks above threshold,
  descending by score).
- **Session state** — get-or-create a session's record; read it without
  creating; clear one session; clear all (test affordance).
- **Chat** — answer a question for a session (resolves to a `RagAnswer`);
  answer a question as a stream (an async iterable of `AnswerStreamEvent`
  terminated by the done event); read a session's chat history in chronological
  order.
- **Usage** — read a session's `UsageSnapshot`; safe at any time, allocates
  nothing for an unknown session.
- **Provider registry** — obtain an embedding client for a session; obtain a
  chat client for a session. Both return governed instances after T06. Services
  must never construct a provider client directly.

**Ports** (`ports.ts`): `EmbeddingClient` (embed texts as documents or as a
query) and `ChatClient` (given a prompt, yield text deltas). These two
interfaces are the injection seam for every test and the decoration seam for
the guardrail.

## Cross-sprint flags

1. **The epic's LanceDB choice is superseded by ADR-12.** The E3 epic file's
   Scope line and its *To settle* "Vector DB" question are answered: no vector
   database is added. The Documenter should correct the epic file and
   `docs/architecture.md` at sprint close.
2. **Sprint 2's "the session store arrives in E4" note is superseded by
   ADR-15.** E4 must **extend** `sessionState.service.ts` — adding its
   uploaded-document list and the three-document rule to the same record — and
   must not introduce a second session registry.
3. **E4 and E7 inherit two contracts from ADR-16:** `USAGE_LIMIT_REACHED` / 429
   *is* the trial-limit signal, and `UsageSnapshot` is already
   JSON-serialisable for a `GET /api/session/:id` response.
4. **E4's SSE layer and E7's UI inherit the terminal-event contract from
   ADR-14:** a stream that ends without the done event was truncated and must
   be surfaced as an error, not rendered as a complete answer.
5. **No TTL or eviction on the session map** (ADR-15). Fine for a single-user
   PoC that is restarted often; E4 or E8 is where an idle timeout belongs if
   the app is ever left running.
6. **A session clear resets the usage budgets** (ADR-16), so anyone able to
   clear sessions can reset the cap. Real quota enforcement needs identity,
   which this PoC does not have — the broader rate-limiting concern stays
   deferred, as the plan scopes it.
7. **Two required env variables land this sprint.** Any environment that runs
   the backend — a future CI job, a deployment, a fresh clone — now fails at
   startup without `VOYAGE_API_KEY` and `ANTHROPIC_API_KEY`. `.env.example` and
   the test script are updated in T01/T03; a CI pipeline added later must
   supply them.
8. **Model ids are verified at ticket time, not carried forward** (ADR-6's
   convention, applied here to the Haiku model id and the Voyage embedding
   model). Anything hard-coded from memory or a tutorial is a defect.
