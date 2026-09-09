# Architecture

Last updated: Sprint 1 (E1 — Backend Foundation). Frontend and RAG pieces
described in `CLAUDE.md` are not built yet; this file documents what actually
exists in the repo today.

## Stack (backend, as built)

- **Runtime:** Node.js, TypeScript (`strict`, ESM, `module: NodeNext`)
- **HTTP framework:** Express 5 ([ADR-1](adr/ADR-1.md)) — chosen over Express
  4 for native async error propagation (a `throw` inside an `async` handler
  reaches the error middleware without a wrapper).
- **Dev/test runtime:** `tsx` ([ADR-2](adr/ADR-2.md)) — runs TypeScript
  directly in dev (`tsx watch`) and loads tests (`node --import tsx --test`).
  Production runs compiled JS from `dist/` (`pnpm build && pnpm start`).
- **Config:** a single typed, fail-fast env module ([ADR-3](adr/ADR-3.md)).
- **Logging:** `pino` + `pino-http`, structured, with `pino-pretty` only in
  development ([ADR-4](adr/ADR-4.md)).
- **Errors:** one `AppError` type and one JSON error envelope for every
  non-2xx response ([ADR-5](adr/ADR-5.md)).
- **Testing:** Node's built-in `node:test`, loaded through `tsx`, zero new
  dependencies ([ADR-8](adr/ADR-8.md)). Mandatory for backend tickets from
  E1-T04 onward ([ADR-7](adr/ADR-7.md)).
- **RAG dependencies** (LangChain, LangGraph, pdf-parse, OpenAI) are
  deliberately not installed yet — added in E2/E3 when first used
  ([ADR-6](adr/ADR-6.md)).

## Backend request flow

```
requestLogger  →  express.json()  →  routes registry  →  notFoundHandler  →  errorHandler
```

- **`src/index.ts`** — entrypoint. Builds the app via `createApp()`, calls
  `listen(env.PORT)`, logs the startup line, and registers `SIGINT`/`SIGTERM`
  (graceful `server.close()`) and `unhandledRejection`/`uncaughtException`
  (log + `process.exit(1)`) handlers.
- **`src/app.ts`** — `createApp(): Express`. Builds and wires the middleware
  chain above but never calls `listen` itself — this is what lets tests
  exercise the app on an ephemeral port without a real process boot.
- **`src/config/env.ts`** — the *only* place `process.env` is read
  (ADR-3). Validates and freezes `PORT` (number, default 3001), `NODE_ENV`
  (`development` / `production` / `test`), `LOG_LEVEL`. Throws a plain `Error`
  on invalid input — a boot-time crash, by design. The validation logic is
  exposed as a pure `loadEnv(source)` function so it can be unit-tested with
  arbitrary inputs without mutating `process.env`; application code always
  imports the frozen `env` singleton, never calls `loadEnv` itself.
- **`src/utils/logger.ts`** — a `pino` singleton, level from `env.LOG_LEVEL`,
  pretty-printed only in development, redacts auth headers/cookies.
- **`src/middleware/requestLogger.ts`** — `pino-http`, mounted first, assigns
  each request a UUID (`req.id`) and skips logging `/health` noise.
- **`src/routes/index.ts`** — the route registry: the only file that needs a
  new line (`router.use('/prefix', someRouter)`) to add a feature route.
  `app.ts` and the error middleware are never touched to add a route.
- **`src/routes/health.route.ts`** — `GET /health`, mounted at the root (not
  under `/api`), returns `{ status, service, uptime, timestamp }`.
- **`src/routes/dev.route.ts`** — `GET /__dev/boom` and `/__dev/boom-async`,
  mounted only when `env.isDevelopment`; exists purely to make the error
  handling paths curl-able. Never mounted in production or test.
- **`src/middleware/notFound.ts`** — terminal handler for unmatched routes;
  forwards `AppError.notFound(...)` into the same error pipeline as every
  other failure (Express 5 dropped `'*'` wildcard routes, so this has no path
  string).
- **`src/middleware/errorHandler.ts`** — the single terminal error handler
  (4-arg signature). Narrows `AppError` → its own status/code; body-parser
  `SyntaxError` → `400 INVALID_JSON`; anything else → generic
  `500 INTERNAL_ERROR` (the real message/stack is logged, **never** returned,
  in every environment). Responds with the error envelope below and logs via
  the request-scoped child logger.
- **`src/errors/AppError.ts`** — `statusCode` + `code` (SCREAMING_SNAKE_CASE)
  + `isOperational`, with `badRequest` / `notFound` / `internal` factories.
- **`src/services/`** — established as an empty, framework-free layer (no
  `express` imports, no `req`/`res`) for future business logic; it signals
  failure by throwing `AppError`. Empty until E2.

### Error envelope

Every non-2xx response, present and future, uses this shape:
```json
{ "error": { "code": "NOT_FOUND", "message": "Route GET /nope not found", "requestId": "3f1c...", "details": null } }
```
`details` is omitted when absent. Codes introduced so far: `NOT_FOUND`,
`INVALID_JSON`, `INTERNAL_ERROR`. Later epics add codes, never a new response
shape (`AppError` is the only way to produce an error response).

## Testing

- Runner: `node:test` via `tsx`, no Jest/Vitest/Chai/`supertest`
  ([ADR-8](adr/ADR-8.md)). Assertions: `node:assert/strict`.
- Tests live in `backend/tests/`, mirroring `src/` one-to-one, and are
  typechecked (but never emitted to `dist/`) via `tsconfig.test.json`.
- HTTP-level tests bind the real app to an ephemeral port (`listen(0)`) and
  call it with global `fetch` — see `tests/helpers/testServer.ts`.
- Policy: every backend ticket ships its own unit tests in the same PR as its
  code, from E1-T04 onward ([ADR-7](adr/ADR-7.md)). No coverage percentage is
  enforced — coverage means the ticket's acceptance criteria and failure
  paths. Frontend tests are a separate, not-yet-made decision.
- Out of scope for unit tests (owned by E8 instead): process-level behavior
  (real port binding, signal shutdown, `uncaughtException` exit) and full
  upload → chunk → retrieve → answer integration/E2E flows.

## Known constraints for future epics

See `design.md`'s "Cross-sprint flags" (archived at
`.claude/handoffs/sprint-1/design.md`) for the full list; the ones most
likely to bite:
- Express 5 path syntax only (no `'*'`, wildcards are `/*splat`).
- Relative imports need a `.js` extension even though files are `.ts`
  (`NodeNext` module resolution).
- CORS is not configured yet — the frontend (`:3000`) calling the backend
  (`:3001`) will be blocked by the browser until E5/E4 adds `cors`.
- Services must stay framework-free so they remain unit-testable without
  booting an HTTP server.
- `node:test` has no `vi.mock`-style module interception; later epics that
  need to swap out a collaborator (e.g. E3's LLM client) must inject it.

## Not built yet

- Document upload/parsing, chunking, embeddings (E2)
- LangChain/LangGraph RAG orchestration (E3)
- `/api/session*` endpoints (E4)
- Frontend — onboarding + chat UI (E5–E7)
- Integration/E2E testing (E8)
