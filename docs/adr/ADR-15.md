# ADR-15: E3 owns one in-memory session-state registry; E4 layers HTTP on top of it

- **Status:** Accepted
- **Date:** 2026-09-09
- **Sprint / Tickets:** Sprint 3 — E3-T02, E3-T05, E3-T06

## Context
Sprint 2 recorded that "the session store arrives in E4" — that was true when
nothing before E4 had session-scoped state to hold. E3 changes that: three of
its six tickets need per-session state *before* any HTTP endpoint exists.

- E3-T02 — a vector index per session, with no cross-session leakage.
- E3-T05 — an ordered chat history per session, retained until an explicit
  session clear.
- E3-T06 — cumulative usage counters per session, isolated between sessions.

The tempting shape is three independent module-level `Map`s, one per ticket,
each keyed by session id. It works, and it is wrong in a specific way: "clear
the session" then means remembering to clear three registries, and every future
piece of session state (E4's uploaded-document list, the three-documents rule)
adds a fourth place to forget. The bug that produces — a cleared session whose
usage counters or vectors survive — is silent and, for the usage counters,
exploitable.

`CLAUDE.md` fixes the storage decision itself (in-memory, no database, PoC), so
the question is not *where* state lives but *who owns the keyed container*.

## Decision
Introduce **one** session-state registry in the service layer,
`src/services/sessionState.service.ts`, created by E3-T02 and extended by
E3-T05 and E3-T06. It is a single map from session id to one `SessionState`
record holding every per-session concern E3 has, and it exposes a small
API: get-or-create the state for a session, read the state without creating it,
clear one session, and clear everything (a test affordance).

- The registry is **framework-free** (sprint-1's layering rule): no `express`,
  no `req`/`res`. E4 calls it from route handlers; it never imports E4.
- All state is plain, JSON-serialisable data, as in E2's `document.types.ts`,
  except the vector arrays — which are internal to the index and never returned
  from a public function.
- **Clearing a session drops the whole record in one operation**, so the
  vector index, the chat history and the usage counters can never diverge.
- **Reads do not create state.** A query about an unknown session (notably the
  remaining-usage query, which a UI may poll) returns a well-defined empty/fresh
  answer without allocating a record, so an unauthenticated caller cannot grow
  the map by inventing session ids.
- E3 does **not** own session lifecycle semantics. It has no notion of a session
  being "valid", no creation endpoint and no 404 for an unknown id: an unknown
  session simply behaves as one with an empty index and empty history. E4 owns
  creation, existence checks and the HTTP 404, and adds its own fields
  (uploaded documents, the three-document rule) to the same record.

## Consequences
- **Supersedes sprint-2's "the session store arrives in E4" note.** E4 extends
  this registry — it must not introduce a second one, and the Documenter should
  correct `docs/architecture.md` accordingly at sprint close.
- Session clear is one call with one obvious correctness property, which is what
  E3-T05's "history is discarded only on an explicit session-clear, never
  silently dropped" criterion actually needs.
- Because the registry is a module-level singleton, tests must be able to reset
  it; the clear-everything affordance exists for that and is why the E3 services
  stay independently testable despite shared state.
- State is process memory only. A restart loses every session — accepted and
  already documented by `CLAUDE.md`'s PoC stance — and there is **no TTL or
  eviction**, so the map grows for the process's lifetime with one record per
  session id ever seen. Acceptable for a single-user PoC; flagged for E4/E8 as
  the place to add an idle timeout if the app is ever left running. The
  no-allocation-on-read rule above keeps the growth tied to real usage.
- Concurrency is whatever Node's single-threaded event loop gives us. Two
  simultaneous requests for the same session can interleave between an `await`
  and a subsequent write. `CLAUDE.md` scopes this to a single user session at a
  time, so no locking is introduced; the usage counters (ADR-16) are the one
  place where an interleave has a cost consequence, and it is bounded by one
  extra in-flight call.

## Alternatives rejected
- **A separate module-level map per concern.** Smaller diffs per ticket and no
  shared type, at the price of a session-clear operation that has to be kept in
  sync across three (soon four) modules. The failure mode is silent and, for
  usage counters, a way around the cap.
- **Deferring all of it to E4 and passing state in as arguments.** Keeps E3
  stateless and pure, but every E3 entry point would take an index, a history
  and a usage record as parameters, and E4 would be the first place the
  invariant "these three belong to the same session" is expressed — one epic
  after the code that depends on it.
- **A class-based `Session` object with methods.** Idiomatic, but the repo's
  established style is plain data plus free functions (E2's whole service
  layer), and `CLAUDE.md` prefers plain JSON-serialisable shapes so E4 can
  return them from a route unmapped.
- **LangGraph's checkpointer (`MemorySaver`) as the conversation store.** It is
  built for exactly this and would carry chat history for free. Rejected because
  it stores LangGraph-shaped checkpoints rather than our own history type,
  covers only one of the three concerns, and would put a second, parallel
  session-keyed store next to the one the other two concerns still need.
  Revisit if E4 or a later epic wants graph-level resumability.
