# ADR-14: One LangGraph graph serves both the streaming and non-streaming answer paths, with a sliding-window conversation strategy

- **Status:** Accepted
- **Date:** 2026-09-09
- **Sprint / Tickets:** Sprint 3 — E3-T03, E3-T04, E3-T05

## Context
`CLAUDE.md`'s *Decisions Already Made* commits the RAG engine to **LangChain +
LangGraph**, and the E3 epic describes the workflow as Retrieve → Format →
Prompt → LLM with streaming output. Three acceptance criteria interact here and
are easy to satisfy in ways that quietly contradict each other:

- E3-T03: an answer grounded in retrieved chunks, and a "no relevant
  information" response when retrieval finds nothing.
- E3-T04: an incremental token stream whose concatenation is **the same final
  answer** as the non-streaming path, and a mid-stream failure that surfaces as
  a clear error rather than a truncated answer presented as complete.
- E3-T05: follow-up questions answered using prior turns, without unbounded
  prompt growth over a long conversation.

The naive shape — one code path for `invoke`, a second for streaming — makes
"the same final answer" an aspiration rather than a structural guarantee, and
doubles the surface the usage guardrail (ADR-16) has to cover.

The epic's *To settle* list also leaves "context window management for long
conversations" and "multi-turn conversation strategy" open. Both are settled
here.

Everything below was verified against `@langchain/langgraph@1.4.14` and
`@langchain/anthropic@1.5.9` (peer `@langchain/core@^1.2.9`, matching the
version ADR-9 pinned) by building and running a real graph before this ADR was
written.

## Decision

### One graph, two ways to consume it
Build a **single compiled `StateGraph`** with two nodes — `retrieve` and
`generate` — and a conditional edge out of `retrieve` that goes to `generate`
when relevant chunks were found, and straight to the end when none were.

- The **non-streaming** entry point runs the graph with `invoke` and reads the
  answer off the final state.
- The **streaming** entry point runs the same compiled graph with
  `streamMode: 'custom'`. Inside the `generate` node, the writer obtained from
  LangGraph's `getWriter()` emits one event per token as the provider yields
  it, and the node still returns the fully accumulated answer as its state
  update. Verified: the writer is a live function in **both** modes (a no-op
  sink under `invoke`), so the node needs no branch and no knowledge of how it
  is being consumed.

That is what makes E3-T04's "same final answer" criterion structural: there is
one prompt-building path, one provider call and one accumulation, and the
stream is a side channel off it rather than a parallel implementation.

Verified behaviour the implementation and its tests may rely on:

| Observation | Result |
|---|---|
| `streamMode: 'custom'` | yields exactly the values the node wrote, in order |
| `streamMode: ['custom','updates']` | yields tagged pairs; custom events arrive before the node's state update |
| An error thrown inside a node | reaches the caller **unwrapped** — same class, same `name`, same custom properties, on both `invoke` and `stream` |
| Writing then throwing mid-node | already-written events are delivered, then the async iterator throws |

The unwrapped-error result is load-bearing: an `AppError` thrown in a node
arrives at the caller as an `AppError`, so ADR-5's single error envelope
survives the graph and E4 needs no LangGraph-specific error handling.

### The no-context short circuit
When retrieval returns zero chunks above the relevance threshold, the graph
**does not call the LLM at all** and the answer is a fixed
"no relevant information in your documents" message. This satisfies the
"never fabricate" criterion at its strongest (the model is never given the
opportunity), it is deterministic and cheap to test, and it spends nothing —
which matters given ADR-16 exists.

### Conversation strategy (the epic's two open questions)
- **Retrieval query.** When history exists, the text sent for query embedding
  is the current question preceded by the last few **user** messages, joined as
  plain text. This is what lets "what about the second one?" retrieve anything
  at all, and it costs nothing beyond the query embedding that was happening
  anyway.
- **Prompt history.** The prompt carries a **fixed-size sliding window** of the
  most recent messages, further truncated by a character budget, both frozen
  constants. Older turns are dropped, oldest first. The window bounds the prompt
  by construction, so "a long conversation still answers" is a property of the
  design rather than something to hope for.
- **Nothing is summarised, condensed or rewritten by a second LLM call.** The
  plan puts compression out of scope, and a condense-the-question call would
  double the per-message LLM spend and eat into the 3-second budget.

Dropping old turns from the *prompt* never drops them from the session's
**stored** history, which is retained in full until an explicit session clear
(E3-T05's no-data-loss criterion). The window is a prompt-construction concern
only.

## Consequences
- `@langchain/langgraph@^1.4.14` and `@langchain/anthropic@^1.5.9` are added in
  E3-T03, at versions whose `@langchain/core` peer (`^1.1.48` and `^1.2.9`
  respectively) is satisfied by the `^1.2.9` ADR-9 already pinned. Do not add
  the `langchain` meta-package (ADR-9).
- `@langchain/langgraph` declares **`zod` as a peer** (`^3.25.32 || ^4.2.0`).
  `zod@4.5.4` is already present transitively via `@langchain/core`, and
  `pnpm add` resolved it without a peer warning in a clean probe. If a future
  install does warn, declare `zod` explicitly at the version core resolves —
  do not downgrade anything to silence it.
- The graph's state schema may be expressed with LangGraph's `Annotation` root
  or its zod state schema; both are supported in v1 and `Annotation` was the one
  verified. The channels are fixed by the design, the syntax is the Coder's.
- Two nodes rather than the epic's four-stage wording (Retrieve → Format →
  Prompt → LLM). Formatting and prompt assembly are pure functions with no I/O
  and no branching of their own; making them graph nodes would add two state
  channels and two hops to serialise a string. They stay as testable
  pure helpers called from `generate`. A reviewer should not fail E3-T03 for
  having two nodes instead of four.
- The graph is the **only** path to the chat model. Nothing else may construct
  or call one (ADR-16 depends on this for the guardrail to be unbypassable).
- Streaming consumers must treat the terminal event as the completion signal:
  a stream that ends without it was truncated. E4's SSE mapping and E7's UI both
  inherit that contract.
- Long-conversation quality degrades gracefully rather than failing — a question
  referring to something forty turns back may lose the reference. That is the
  accepted trade against an unbounded prompt, and the knobs are two constants.
- LangGraph is ~4.3 MB unpacked plus its checkpoint/SDK/protocol dependencies,
  for a two-node linear graph. That weight is accepted because `CLAUDE.md`
  decided it, not because the graph earns it on its own; see below.

## Alternatives rejected
- **Plain function composition instead of LangGraph** (retrieve, then format,
  then call). For a two-node linear flow this is smaller, has no dependency, and
  is easier to read — genuinely the better engineering choice on today's
  requirements alone. It is rejected because `CLAUDE.md`'s *Decisions Already
  Made* fixes LangGraph for the RAG engine, and that file's own rule is to ask
  before changing a made decision rather than quietly diverging. LangGraph also
  pays off in the epics that follow (conditional routing, checkpointed
  conversation state, tool use) and the streaming writer used above is
  precisely the seam that would otherwise have to be hand-built. Recorded here
  so a future reader knows the cost was seen, not missed.
- **Separate streaming and non-streaming implementations.** The obvious way to
  do E3-T04 as an "extension" of E3-T03, and the way "the stream concatenates to
  the same answer as `invoke`" becomes a test that passes today and drifts next
  sprint. Two prompt builders is two places for the guardrail to be forgotten.
- **`streamMode: 'messages'`** (LangGraph's built-in chat-model token stream).
  Fewer lines than the explicit writer, but it couples the stream's event shape
  to LangChain's message-chunk types, which then leak to E4's SSE layer and
  E7's UI. The custom channel lets us emit our own small, JSON-serialisable
  event shape, and it keeps working if the provider adapter is ever swapped.
- **Query rewriting / condensing follow-ups with an extra LLM call.** The
  textbook multi-turn RAG answer and measurably better on pronoun-heavy
  follow-ups. Rejected on cost and latency: it doubles LLM calls per message in
  an epic whose companion ticket exists solely to cap LLM spend, and it adds a
  full round-trip to a 3-second budget. Revisit if retrieval quality on
  follow-ups proves inadequate in E8.
- **Summarising old turns to compress history.** Explicitly out of the plan's
  scope, and it is another LLM call, with the same objection.
