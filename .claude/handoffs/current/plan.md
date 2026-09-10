# Plan — E3: RAG Engine (LangChain + LangGraph)

## Sprint Breakdown
- Sprint 3: E3-T01, E3-T02, E3-T03, E3-T04, E3-T05, E3-T06

**Revision note:** this plan was revised after human review to add cost-consciousness (E3-T01) and a per-session usage guardrail (new E3-T06). E3-T06 resolves sprint 1's deferred cross-sprint flag ("Rate limiting stays deferred ... revisit when the [LLM] key is live in E3 — an unauthenticated PoC endpoint that spends money per request is the point where this stops being premature," `sprint-1/design.md`) — it is not a newly-introduced concern, it is that flag coming due now that E3 makes the first paid API calls (Claude + Voyage AI).

## Tickets

### E3-T01: Chunk & Query Embedding (Voyage AI) — Sprint 3
**Description:** As a developer building the RAG pipeline, I need document chunks and user queries converted into embedding vectors via Voyage AI, so that semantic similarity search is possible in the next stage.
**Acceptance Criteria:**
- Given one or more `Chunk`s (from E2's pipeline), the service returns an embedding vector for each chunk's text, preserving chunk identity/order.
- Given a single query string, the service returns its embedding vector using the same embedding model as document chunks (so query and chunk vectors are directly comparable).
- A Voyage AI request failure (network/auth error) surfaces as a clear, typed error rather than a silent empty result or process crash.
- A missing `VOYAGE_API_KEY` is caught at startup (env validation, per ADR-3's pattern), not on first use.
- Embedding usage targets keeping cost near $0, preferring Voyage AI's free tier; the exact free-tier limits/terms are verified against Voyage's current docs at implementation time (the same "verify against the registry/docs at ticket time" convention ADR-6 established for package names/versions) rather than hard-coded here from a number that could be stale by build time.
- Unit tests cover: chunk-to-vector embedding with an injected/fake Voyage client, query embedding, and the API-failure error path; runnable via `pnpm test`.
**E2E Flows:**
- Developer passes a batch of chunks from a processed document → receives one embedding vector per chunk, in the same order.
- Developer passes a user's chat query string → receives its embedding vector, ready to compare against indexed chunk vectors.
- Developer triggers embedding with the Voyage API unreachable → receives a clear failure rather than a crash or silent empty vector.

### E3-T02: Session Vector Index & Semantic Search — Sprint 3
**Description:** As a developer building the RAG pipeline, I need each session's embedded chunks indexed in an in-memory vector store and searchable by similarity, so a user's query can retrieve the most relevant chunks from their uploaded documents.
**Acceptance Criteria:**
- Given a session's embedded chunks, they are indexed into an in-memory vector store scoped to that session (no cross-session leakage).
- Given a query embedding, a search returns the top-3 most semantically similar chunks for that session, ordered by relevance.
- Chunks below a minimum relevance threshold are filtered out rather than always returned, so an unrelated query can return fewer than 3 (or zero) results.
- Each result carries enough of the original chunk's metadata (document title, page number) to attribute an answer back to its source later.
- Indexing and searching a typical session's chunks (a few dozen) is fast enough not to be the bottleneck in the epic's <3s end-to-end response target.
- Unit tests cover: indexing chunks, retrieving top-3 relevant results for an on-topic query, filtering an irrelevant query down to fewer/zero results, and session isolation (session A's index never returns session B's chunks); runnable via `pnpm test`.
**E2E Flows:**
- Developer indexes a session's embedded chunks, then searches with an on-topic query embedding → receives the top-3 most relevant chunks with attribution metadata.
- Developer searches with a clearly off-topic query → receives fewer than 3 (or zero) results instead of forced matches.
- Developer indexes two different sessions and searches one of them → never receives chunks belonging to the other session.

### E3-T03: RAG Answer Generation (LangGraph + Claude) — Sprint 3
**Description:** As a user chatting about my uploaded documents, I want my question answered using content actually retrieved from my documents, so the AI's response is grounded in what I uploaded rather than a generic answer.
**Acceptance Criteria:**
- Given a session and a user question, the top relevant chunks retrieved via E3-T02 are formatted into context and passed to the LLM (Claude, orchestrated via LangGraph) alongside the question.
- The generated answer is returned as a single result tied to the question that produced it.
- If no relevant chunks are found for a question, the response indicates there is no relevant information available, rather than fabricating an answer or crashing.
- A missing `ANTHROPIC_API_KEY` is caught at startup, not on first use.
- A typical retrieval + LLM round-trip completes in under 3 seconds for a normal question (epic acceptance criterion).
- Each LLM call is a call site the per-session usage guardrail (E3-T06) applies to — this ticket does not need to implement the cap itself, but must not bypass it (e.g., no direct, ungoverned path to the LLM client).
- The LLM call uses the cheapest available Claude model tier (Haiku), not a higher tier, for cost reasons (CLAUDE.md decision); the exact current Haiku model id is verified against Anthropic's docs at implementation time rather than hard-coded here (the same verify-at-ticket-time convention already used for Voyage's free tier and package versions).
- The model id is configurable via an env var (following ADR-3's typed env-config module pattern) rather than hard-coded in source, defaulting to the Haiku tier decided above when unset; unlike `ANTHROPIC_API_KEY`/`VOYAGE_API_KEY`, a missing/unset model id falls back to its default rather than failing startup — only a malformed *provided* value should be rejected fail-fast, per ADR-3. Exact env var name and default value string are verified against Anthropic's docs at implementation time, not prescribed here.
- Unit tests cover: an answer grounded in provided context (LLM call injected/faked, per ADR-8's collaborator-injection convention), the no-relevant-chunks path, and an LLM-failure path surfacing a clear error; runnable via `pnpm test`.
**E2E Flows:**
- User asks a question covered by their uploaded documents → receives an answer whose content is traceable to the retrieved chunks.
- User asks a question unrelated to any uploaded document → receives a clear "no relevant information" response instead of a fabricated answer.
- The LLM provider call fails → the flow surfaces a clear error, not a hang or crash.

### E3-T04: Streaming Answer Output — Sprint 3
**Description:** As a user chatting with the AI, I want the answer to start appearing as it's generated rather than waiting for the full response, so the conversation feels responsive.
**Acceptance Criteria:**
- Given the same retrieve → prompt → LLM flow as E3-T03 (including the same cost-conscious Haiku model call — no new model decision needed here), the answer is produced as an incremental stream of tokens/segments rather than only as one final string.
- Consuming a stream to completion yields the same final answer content as the non-streaming path for the same question and context.
- A mid-stream failure (e.g., a provider error partway through generation) is surfaced to the consumer as a clear error, not a silently truncated response presented as complete.
- Unit tests cover: consuming a full stream reconstructs the expected answer, and a mid-stream failure is surfaced clearly; runnable via `pnpm test`.
**E2E Flows:**
- Developer/consumer requests an answer for a question → receives incremental pieces of the answer as they become available, concatenating to the same final answer as the non-streaming call.
- The stream fails partway through → the consumer receives a clear error signal instead of an incomplete answer presented as complete.

### E3-T05: Multi-turn Chat History & Context — Sprint 3
**Description:** As a user having a conversation about my documents, I want my follow-up questions understood in light of what I already asked, and my conversation to persist for the life of my session, so I don't have to repeat context in every message.
**Acceptance Criteria:**
- Each session maintains its own ordered chat history (user questions and AI answers) for the duration of the session.
- A follow-up question is answered using both retrieved document context and relevant prior conversation turns (e.g., a question like "what about the second one?" is answerable using the immediately preceding turn).
- An extended conversation (many turns) does not cause request failures or unbounded prompt growth that breaks the LLM call.
- Chat history is retrievable on demand, in chronological order.
- History is retained for as long as the session is active; it is discarded only on an explicit session-clear, never silently dropped mid-session (epic's "no data loss on session timeout" criterion).
- Unit tests cover: a follow-up question resolved correctly using prior turns, history retrieval in chronological order, and a long-running conversation continuing to produce answers without failure; runnable via `pnpm test`.
**E2E Flows:**
- User asks a question, then a follow-up that depends on the first → the follow-up is answered correctly using the earlier context.
- User has a long conversation (many turns) → later questions still get answered successfully, without the request failing due to conversation size.
- Developer/consumer requests a session's chat history → receives all turns in chronological order.

### E3-T06: Per-Session Usage Guardrail — Sprint 3
**Description:** As the operator of this PoC, I want each session's embedding and LLM usage capped, so a single session can't run unbounded cost against paid APIs (Claude, Voyage AI). This app is meant for a quick trial, not sustained/heavy use. This ticket resolves sprint 1's deferred cross-sprint flag ("Rate limiting stays deferred ... revisit when the [LLM] key is live in E3 — an unauthenticated PoC endpoint that spends money per request is the point where this stops being premature") now that E3-T01/T03 make the first paid calls.
**Acceptance Criteria:**
- A session's embedding calls (E3-T01) and LLM calls (E3-T03/T04) are each capped at an enforced per-session limit; once reached, further calls of that kind are blocked before reaching the paid API rather than proceeding or crashing.
- The cap is enforced cumulatively across the session's lifetime, not just per individual request — many small requests hit the same cap a few large ones would.
- When a session hits its cap, the caller receives a clear, distinguishable "limit reached" result (not a generic/internal error), so a later UI (E7) can tell the user they've reached the trial limit.
- Normal exploratory usage (uploading a few documents and asking a handful of questions in one session) comfortably fits under the cap without being interrupted.
- A fresh session's usage is entirely independent of any other session's — hitting one session's cap never affects another session.
- The guardrail exposes the session's remaining usage as a percentage/fraction of its cap (not just an allowed/blocked boolean), queryable at any point in the session — including before the cap is reached — so a future UI (E4/E7) can display "remaining trial usage" to the user. Actual display/formatting is out of scope here; only the underlying data needs to exist.
- Unit tests cover: usage accumulating toward the cap across multiple calls within a session, a call being blocked once the cap is reached, per-session isolation of the cap, and the remaining-usage figure changing correctly as calls are made; runnable via `pnpm test`.
**E2E Flows:**
- User uploads documents and asks a normal handful of questions in one session → every call succeeds, the cap is never encountered.
- User (or a script) keeps sending requests well past normal trial usage in the same session → further embedding/LLM calls are blocked with a clear "limit reached" result instead of continuing to spend money.
- User starts a new session after a previous session hit its limit → the new session works normally, unaffected by the old session's usage.
- Developer/consumer queries a session's remaining usage partway through a conversation → receives a percentage/fraction reflecting how much of the trial cap has been used so far, without needing to trigger a blocked call to find out.

## Out of Scope
- HTTP endpoints for session/chat (`POST /api/session/:id/chat` and related) — belongs to E4 (Backend API Endpoints).
- Frontend chat UI, including how streaming is displayed — belongs to E7 (Chat Interface).
- Persistent storage of embeddings, vector index, or chat history beyond process memory — in-memory only for this PoC (CLAUDE.md), no database.
- The exact Voyage embedding model variant (`voyage-3` vs. `voyage-3-lite` vs. a domain-specific variant) and any embedding cost/quality tuning — an implementation decision for the Architect/Coder within E3-T01, package/model verified against the registry/docs at ticket time (ADR-6's convention), not a planning decision.
- Advanced context-window compression strategies (e.g., summarizing old turns, token-based truncation) beyond what E3-T05's "does not break on long conversations" acceptance criterion requires — revisit if real usage shows a problem.
- Broader rate-limiting infrastructure beyond a per-session usage cap — e.g., IP-based throttling, authentication/authorization-based quotas, distributed rate limiting across processes. Only the single-session guardrail (E3-T06) is in scope this sprint; multi-user concurrency guarantees beyond simple in-memory per-session isolation remain deferred, consistent with CLAUDE.md's single-user-session PoC scope.
- The exact numeric cap(s) for E3-T06 (how many embedding/LLM calls, what window) — an Architect/Coder implementation decision, not prescribed by this plan.
- Formatting/display of citations (page numbers, source titles) to the end user — belongs to E4/E7; E3-T02/T03 only need to preserve attribution metadata through retrieval and into the answer, not format it for display.

## Open Questions
None blocking sprint planning. On the epic's "to settle" list:
- **Vector DB** is already decided at the epic level — the epic's Scope section names LanceDB explicitly (the "to settle" line predates that decision and is stale).
- **Embedding model variant**, **context window management**, and **multi-turn conversation strategy** are implementation-level decisions, not planning blockers: they're addressed above as outcome-level acceptance criteria (comparable query/chunk vectors, bounded conversation growth, follow-up resolution using prior turns) without prescribing a mechanism, leaving the specific approach to the Architect's design.md, consistent with the Planner's role of describing outcomes rather than implementation.
