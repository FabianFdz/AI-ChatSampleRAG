# Sprint 1 — E1: Backend Foundation

Epic [E1 — Backend Foundation](../epics/E1-backend-foundation.md) is **done**
as of this sprint: the foundation every later backend epic (E2/E3/E4) builds
on is shipped and merged.

## Shipped tickets

- **E1-T01 — Express Server Bootstrap.** TypeScript Express 5 server with a
  typed, fail-fast env config module (`PORT`, `NODE_ENV`, `LOG_LEVEL`), `tsx`
  dev runtime, and a clean `pnpm build && pnpm start` path from `dist/`.
- **E1-T02 — Health Check Endpoint.** `GET /health` returns `200` with
  `{ status, service, uptime, timestamp }`, mounted at the root via the new
  route registry (`src/routes/index.ts`), independent of any other feature.
- **E1-T03 — Global Error Handling & Modular Route/Service Structure.**
  Structured `pino`/`pino-http` logging, an `AppError` type, a single JSON
  error envelope for every non-2xx response (including 404s), and the
  `routes/`/`services/` layering that future epics extend.
- **E1-T04 — Unit Test Coverage for Backend Foundation** *(mid-sprint
  addition, not in the original plan)*. Tests-only ticket retroactively
  covering T01–T03 with `node:test` run through `tsx`. Added a pure
  `loadEnv(source)` seam to `src/config/env.ts` (the one behavior-preserving
  change to `src/`) so env parsing is unit-testable without mutating
  `process.env`.

## Notable decisions / ADRs

- [ADR-1](../adr/ADR-1.md) — Express 5, not Express 4 (native async error
  propagation).
- [ADR-2](../adr/ADR-2.md) — `tsx` dev runtime, ESM + `module: NodeNext`.
- [ADR-3](../adr/ADR-3.md) — single typed, fail-fast env config module.
- [ADR-4](../adr/ADR-4.md) — `pino` + `pino-http` structured logging.
- [ADR-5](../adr/ADR-5.md) — `AppError` + one JSON error envelope.
- [ADR-6](../adr/ADR-6.md) — defer unused RAG dependencies to E2/E3 (the
  scaffolded `langgraph` dependency name was invalid; corrected to
  `@langchain/langgraph` when actually needed).
- **[ADR-7](../adr/ADR-7.md)** — process decision, made mid-sprint: unit
  tests are now required for every backend ticket going forward. `CLAUDE.md`'s
  `Decisions Already Made` and `Testing` sections were updated to reflect
  this; it supersedes the earlier "no tests required yet" PoC note for the
  backend only (frontend policy is unchanged and needs its own future ADR).
- **[ADR-8](../adr/ADR-8.md)** — tooling choice for ADR-7: Node's built-in
  `node:test`, loaded through the already-installed `tsx`, zero new
  dependencies. No Jest/Vitest/Chai/`supertest`.

## Known issues / carry-overs

- **CORS is not configured.** The frontend (`:3000`) calling the backend
  (`:3001`) will be blocked by the browser until `cors` is added, restricted
  to the frontend origin — flagged for E5/E4, do not rediscover this during
  E8 integration.
- **Rate limiting stays deferred** until the OpenAI key is live in E3 — an
  unauthenticated PoC endpoint that spends money per request is the point
  where this stops being premature.
- **E8 (testing epic) is narrowed, not cancelled** by ADR-7: per-ticket unit
  tests now cover route/service behavior, so E8 owns what they cannot —
  process-level tests (real port binding, signal shutdown,
  `uncaughtException` exit) and full upload → chunk → retrieve → answer
  integration/E2E flows.
- **Testability is now a design constraint** for E2/E3: anything read at
  import time (env, clock, network client) needs a pure, injectable seam like
  `loadEnv`. E3 specifically must inject its LLM/LangChain client rather than
  relying on module interception, since `node:test` has no `vi.mock`
  equivalent.
