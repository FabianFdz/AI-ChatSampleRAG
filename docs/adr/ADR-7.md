# ADR-7: Unit tests are required for backend tickets going forward

- **Status:** Accepted
- **Date:** 2026-09-09
- **Sprint / Tickets:** Sprint 1 — decided during E1-T03, first applied by E1-T04
- **Type:** Process / policy decision (not a code architecture decision)

## Context
`CLAUDE.md` originally set the testing policy for this project as:

```
## Testing
- Manual testing via frontend
- No tests required yet (PoC)
```

That was a deliberate PoC trade-off: get a working RAG demo fast, verify by
hand, and let the dedicated testing epic (E8) add automated coverage later.
Sprint 1 was planned and executed under that policy — **E1-T01 (Express
bootstrap + env config) and E1-T02 (health check) were merged with no tests,
and E1-T03 (error handling + route/service structure) was implemented to its
original, test-free scope.**

On **2026-09-09** the human owner overrode that policy mid-sprint and updated
`CLAUDE.md` accordingly (`Decisions Already Made` + `Testing` sections). The
reasoning behind the override, and why it is worth accepting a policy change
mid-sprint:

1. E1 is the *foundation* every later epic sits on. The error envelope
   (ADR-5), the env contract (ADR-3), and the route registry are load-bearing
   for E2/E3/E4. A silent regression here surfaces as a confusing failure two
   epics away.
2. Most of this code is AI-generated. Per the sprint-runner contract,
   AI-generated code carries more and subtler defects per line, and manual
   `curl` checks are exactly the kind of verification that stops being
   repeated after the first day.
3. Deferring *all* coverage to E8 means the regressions get found in the
   sprint where the RAG behaviour is also new and unstable — the worst
   possible moment to be debugging whether the 404 handler still works.
4. The cost is low: the backend services layer is deliberately framework-free
   (`design.md` cross-sprint flag 7), so unit-testing it needs no HTTP
   scaffolding, and the runner needs no new dependencies (ADR-8).

## Decision
**Every backend ticket from E1-T04 onward ships unit tests in the same PR as
its code.** Concretely:

1. Tests covering a ticket's own acceptance criteria are part of that ticket's
   Definition of Done. A backend PR with new logic and no tests is
   incomplete, and the Reviewer treats a missing test as a review finding, not
   a nice-to-have.
2. Coverage means *the acceptance criteria and the failure paths*, not a
   percentage target. No coverage threshold is imposed or measured — a line
   count is not evidence, and gaming it wastes PoC time.
3. Retroactive coverage for the already-merged/in-flight foundation
   (E1-T01/T02/T03) is handled once, by **E1-T04**, as a tests-only ticket.
   Merged PRs are not reopened and E1-T03 is not re-scoped mid-implementation.
4. **Frontend policy is unchanged**: no frontend tests are required yet. When
   the frontend lands (E5+) it needs its own decision and its own ADR — the
   backend runner from ADR-8 does not automatically carry over to React/JSX
   with a DOM.
5. E8 (testing epic) is **not** cancelled by this. Its scope narrows to what a
   per-ticket unit test cannot cover: integration/E2E flows, spawning the real
   server process, real port binding and shutdown signals, and full
   upload → chunk → retrieve → answer paths.

Tooling for point 1 is a separate decision — see **ADR-8**.

## Consequences
- Every backend ticket's estimate now includes its tests; a "code only" PR
  will bounce in review. Planner and Coder should assume a modestly larger
  diff per backend ticket (roughly +30–60 lines of tests for a typical route
  or service), which stays inside the contract's ~200-line reviewable budget
  because tickets are small.
- Tests must be *runnable by one documented command* (`pnpm test` in
  `backend/`), so the Reviewer can verify a claim instead of trusting it.
- Testability is now a design constraint, not an afterthought. Modules that
  read `process.env`, the clock, or the network at import time are hard to
  unit test; the design must expose a pure, injectable seam instead. E1-T04
  already forces one such (small, behaviour-preserving) seam in
  `src/config/env.ts`.
- Cross-sprint: E2/E3/E4 tickets each add their own test files under
  `backend/tests/`, following E1-T04's layout. Services stay framework-free so
  they can be tested without HTTP.
- This ADR supersedes the "No tests required yet (PoC)" line in `CLAUDE.md`
  for the backend only. If the policy is ever relaxed again, supersede this
  ADR rather than editing `CLAUDE.md` alone — the ADR is the durable record of
  *why*.

## Alternatives rejected
- **Keep "no tests" until E8.** The status quo. Cheapest per ticket, but it
  concentrates all regression discovery into the epic with the most new and
  least understood behaviour, and leaves the foundation everything else
  depends on unverified. Explicitly overridden by the owner.
- **Retrofit tests into E1-T01/T02/T03 by reopening their PRs.** T01 and T02
  are already merged; reopening them churns history, and re-scoping T03
  mid-implementation breaks the "never re-split a ticket after coding starts"
  rule in the contract. One tests-only ticket (E1-T04) achieves the same
  coverage with a clean, separately reviewable diff.
- **Require tests for the frontend at the same time.** No frontend code exists
  yet, so the decision would be made with zero context and would drag in a
  DOM/component-testing stack (jsdom, Testing Library) months before anything
  imports it — the same mistake ADR-6 corrected for the RAG dependencies.
- **Impose a coverage percentage gate.** Measurable, but in a PoC it buys
  test-shaped filler over tests of the failure paths that actually matter, and
  it needs a coverage tool and CI wiring that do not exist yet.
