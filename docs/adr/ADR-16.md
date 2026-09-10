# ADR-16: The per-session usage guardrail is a decorator on the provider ports, budgeted in calls and characters

- **Status:** Accepted
- **Date:** 2026-09-09
- **Sprint / Tickets:** Sprint 3 — E3-T06 (constrains E3-T01, E3-T03, E3-T04)

## Context
E3 makes this project's first calls that cost money — Voyage AI for embeddings,
Claude for generation — from endpoints that E4 will expose with no
authentication. Sprint 1 deferred rate limiting with an explicit condition:
"revisit when the [LLM] key is live in E3 — an unauthenticated PoC endpoint
that spends money per request is the point where this stops being premature."
E3-T06 is that flag coming due.

The acceptance criteria are unusually specific about *shape*, and they rule out
the two easiest implementations:

- The cap is **cumulative over the session's lifetime**, and "many small
  requests hit the same cap a few large ones would" — so a per-request check is
  not enough, and a pure call counter lets one session embed three 10 MB
  documents repeatedly while a hundred one-line questions are blocked.
- Blocking must happen **before** the paid API is reached, and must surface as a
  **distinguishable "limit reached" result**, not a generic error, so E7 can say
  "you have reached the trial limit".
- Remaining usage must be readable as a **fraction of the cap at any point**,
  including before the cap is hit, without triggering a blocked call to find
  out.
- E3-T03's own criteria add: the LLM call must have "no direct, ungoverned path
  to the LLM client".

This is a new ticket type for this project — nothing in E1 or E2 has an
enforcement point — so the enforcement location, the unit of account and the
exposure mechanism are all decided here. The ticket is also sequenced **last**
in the sprint, so the design has to make it a small, local retrofit rather than
a rewrite of E3-T01/T03/T04.

## Decision

### Enforcement is a decorator on the provider ports
Every paid call in E3 goes through one of two project-owned ports: the
`EmbeddingClient` (ADR-13) and the chat client used by the graph's `generate`
node (ADR-14). E3-T06 adds a **governed decorator for each** — same interface
in, same interface out — that charges a session's budget, refuses when the
budget is exhausted, and otherwise delegates.

The decorators are installed in exactly one place: the **provider registry**
(`src/services/providers/providerRegistry.ts`), the single construction site
for both clients, introduced by E3-T01/E3-T03 with a session id parameter that
is unused until this ticket. Services never construct a provider client
themselves.

Consequences of that placement:
- E3-T06's production diff is one module plus the registry's two return
  statements. E3-T01, T03 and T04 are not touched.
- There is no ungoverned path, because there is no other way to obtain a
  client. Adding one is a visible, reviewable act.
- The decorator sees exactly the text about to be sent, which is what makes
  charging accurate and blocking provably pre-flight.
- A reviewer must **not** flag the registry's unused session id parameter in
  E3-T01/T03 as dead code; it is a named seam this ADR requires.

### Two budgets, each with two dimensions
Each session has two independent budgets — one for embeddings, one for the LLM
— and each budget is measured in **both** dimensions:

- **calls** — the number of provider requests made.
- **units** — a deterministic cost proxy: the **character count of the text
  sent to the provider**, plus, for the LLM, the character count of the text it
  generated.

A budget is exhausted when *either* dimension reaches its limit. That is what
makes the AC's two failure patterns converge: the call dimension catches many
small requests, the unit dimension catches a few large ones.

Characters, not tokens, deliberately: neither provider reports a token count
before the call, and the tokenizer that ships with `@langchain/core`
(`js-tiktoken`) is OpenAI's, so it would be a wrong number dressed up as a
precise one. Characters are exact, deterministic, provider-independent, free to
compute, testable without a network, and proportional to cost to within the
constant factor (~4 characters per token) that the limits absorb.

### Charge before, top up after
For each governed call: read the budget, throw if it is already exhausted,
charge one call plus the input's characters, delegate, then add the generated
output's characters on completion. On a mid-stream or mid-call failure, the
output produced so far is still charged, because the provider still bills it.

This means the **final** call of a session may overshoot its limit, by at most
one call's worth of input and output. That is accepted and deliberate: the
alternative is estimating output length before generating it. The overshoot is
bounded by E2's 10 MB document cap on the embedding side and by the chat
client's configured maximum output tokens on the LLM side.

### "Limit reached" is an `AppError` with its own code
Exhaustion throws an `AppError` with code `USAGE_LIMIT_REACHED` and HTTP status
**429**, carrying which budget was exhausted and the usage snapshot in
`details`. This reuses ADR-5's single error envelope, so E4 needs no new
plumbing and E7 distinguishes the case by `code` — no second error channel,
consistent with sprint 2's "why there is no `Result` type".

### Remaining usage is a read-only snapshot
A query function returns, per budget, the calls and units used, their limits,
and a **remaining fraction** in `[0, 1]` — the *minimum* of the two dimensions'
remaining fractions, so the figure never overstates what is left — plus an
overall remaining fraction that is the minimum across both budgets. It is pure
data (no formatting, no percentage string — display belongs to E7), it is safe
to call at any time, it never allocates state for an unknown session (ADR-15),
and it never makes a provider call.

### The limits themselves
The numeric limits live in one frozen constants object next to E3's other
tuning constants, **not** in env config — the plan leaves the numbers to
implementation time and no acceptance criterion asks for them to be tunable at
runtime. The Coder picks values that satisfy the AC "normal exploratory usage
comfortably fits", derived from a stated worst case (three documents of typical
size to embed, plus a generous number of questions with history), with at least
a 2× margin, and records the arithmetic in a comment beside the constants.

## Consequences
- The cap is a **cost guard, not an accounting system**. It does not know
  dollars, tokens or provider pricing, and it is not exact — by design, since
  exactness would require a tokenizer per provider and post-hoc reconciliation.
- Because tests inject fake clients directly (ADR-8), most E3 unit tests bypass
  the decorator entirely. E3-T06 must therefore test the decorator directly
  *and* assert that the registry returns a governed client — otherwise the
  guardrail is only enforced in production, which is the one place nobody is
  watching.
- Counters live in the session-state record (ADR-15), so clearing a session
  resets its budgets. For a PoC that is the intended behaviour — a session
  clear is a fresh trial — but it does mean a caller who can clear sessions can
  reset the cap. Real quota enforcement needs identity, which this PoC does not
  have; that is the deferred, broader rate-limiting concern the plan keeps out
  of scope.
- Two simultaneous requests for one session can both pass the check before
  either charges (ADR-15's interleave note). The overshoot is one extra call —
  acceptable, and not worth a lock in a single-user PoC.
- E4 and E7 inherit two contracts: `USAGE_LIMIT_REACHED` / 429 is the trial
  limit, and the usage snapshot is already JSON-serialisable for a session-info
  response.

## Alternatives rejected
- **A call-count-only cap.** One counter, trivially testable, and the first
  thing most implementations do. It fails the plan's explicit "many small
  requests hit the same cap a few large ones would" criterion in the expensive
  direction: embedding calls vary by four orders of magnitude in cost.
- **A token-count budget using a real tokenizer.** More faithful to what is
  billed. Voyage's token count is only known from the response, Anthropic's
  input tokens likewise, and neither is available *before* the call — which is
  exactly when the block has to happen. `js-tiktoken` would give a plausible
  wrong number for both providers.
- **Enforcement inside the embedding service and the graph node.** Fewer
  moving parts than a decorator, and it is where the session id already is.
  Rejected because it puts the check in two places that both have other jobs,
  it makes "no ungoverned path" a convention rather than a structural property,
  and it would edit three merged tickets to add a fourth.
- **Express middleware counting requests per session.** The conventional rate
  limit, and it would be genuinely simpler — but there is no HTTP surface in
  E3 at all (that is E4), it can only count requests rather than the work they
  cause, and it cannot see a batch of 300 chunk embeddings behind one request.
- **A general-purpose rate limiter (`express-rate-limit`, a token bucket).**
  Time-windowed request throttling, which is a different concern: the plan asks
  for a **lifetime** cumulative cap on spend, not a rate. Broader rate limiting
  is explicitly out of scope this sprint.
- **Returning a "limit reached" result object instead of throwing.** Reads
  nicely at the call site, but it creates the parallel error channel sprint 2
  argued against: every caller would unwrap it and re-throw into ADR-5's
  envelope anyway.
