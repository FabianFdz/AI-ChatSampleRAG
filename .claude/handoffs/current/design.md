# Sprint 1 Design — tickets E1-T01, E1-T02, E1-T03, E1-T04

## Tickets in Scope
- **E1-T01** — Express Server Bootstrap
- **E1-T02** — Health Check Endpoint
- **E1-T03** — Global Error Handling & Modular Route/Service Structure
- **E1-T04** — Unit Test Coverage for Backend Foundation *(added mid-sprint,
  designed after T01/T02 merged and T03 was in review)*

Build them in that order; each assumes the previous is merged. T04 is
tests-only and changes no behaviour from T01–T03.

## ADRs produced
| ADR | Decision |
|---|---|
| [ADR-1](../../../docs/adr/ADR-1.md) | Express 5, not Express 4 (native async error propagation) |
| [ADR-2](../../../docs/adr/ADR-2.md) | `tsx` dev runtime, ESM + `module: NodeNext` |
| [ADR-3](../../../docs/adr/ADR-3.md) | Single typed, fail-fast env config module |
| [ADR-4](../../../docs/adr/ADR-4.md) | `pino` + `pino-http` structured logging |
| [ADR-5](../../../docs/adr/ADR-5.md) | `AppError` + one JSON error envelope |
| [ADR-6](../../../docs/adr/ADR-6.md) | Defer unused RAG dependencies to E2/E3 |
| [ADR-7](../../../docs/adr/ADR-7.md) | **Process:** unit tests required for backend tickets going forward |
| [ADR-8](../../../docs/adr/ADR-8.md) | Backend tests run on `node:test` + `tsx`, zero new dependencies |

## Rules that apply to all four tickets
1. **Relative imports end in `.js`** — `import { env } from './config/env.js'`
   even though the file is `env.ts`. Required by `NodeNext` (ADR-2). Getting
   this wrong breaks `pnpm start` while `pnpm dev` still works, so it will not
   be caught by running the dev server.
2. **No `any`**, no `@ts-ignore`, no non-null `!` assertions. `strict` is on.
3. **`process.env` is read only in `src/config/env.ts`** (ADR-3).
4. **No `console.*`** in application code; use the logger (ADR-4).
5. Do not add packages beyond those listed per ticket. Do not add `cors`,
   `helmet`, `zod`, or a rate limiter this sprint — see *Cross-sprint flags*.
6. Rules 1–4 apply to **test files too**: `.js` extensions on relative imports
   into `src/`, no `any`, no `@ts-ignore`, no `!`. Tests are typechecked
   (T04) — a test file is not an escape hatch from `strict`.

## Technical Approach

### Target file layout after this sprint
```
backend/
├── src/
│   ├── index.ts                    # T01, extended in T03 — entrypoint: listen + shutdown
│   ├── app.ts                      # T01, extended in T02/T03 — builds the Express app
│   ├── config/env.ts               # T01 — the only reader of process.env
│   ├── utils/logger.ts             # T03 — pino singleton
│   ├── errors/AppError.ts          # T03 — operational error type
│   ├── middleware/
│   │   ├── requestLogger.ts        # T03 — pino-http
│   │   ├── notFound.ts             # T03 — terminal 404
│   │   └── errorHandler.ts         # T03 — terminal error handler (4 args)
│   ├── routes/
│   │   ├── index.ts                # T02 — the route registry
│   │   ├── health.route.ts         # T02
│   │   └── dev.route.ts            # T03 — dev-only, verifies error handling
│   └── services/.gitkeep           # T03 — layer established, empty until E2
├── tests/                          # T04 — mirrors src/, never emitted to dist/
│   ├── helpers/testServer.ts       # T04 — listen(0) + fetch helper
│   ├── config/env.test.ts          # T04 — covers T01
│   ├── app.test.ts                 # T04 — covers T02 + T03 wiring
│   ├── errors/AppError.test.ts     # T04 — covers T03
│   └── middleware/
│       └── errorHandler.test.ts    # T04 — covers T03
├── .env.example                    # T01 (committed)
├── tsconfig.json                   # T01
├── tsconfig.test.json              # T04 — typechecks src + tests, noEmit
└── package.json                    # T01, `test` script added in T04
.gitignore                          # T01 (repo root — does not exist yet)
```

**Naming conventions** (new for this repo, follow them in later epics):
route files `*.route.ts`, service files `*.service.ts`, one default-exported
`Router` per route file, `camelCase` filenames elsewhere, `PascalCase` only for
classes.

---

### E1-T01 — Express Server Bootstrap

**Dependency cleanup first (ADR-6).** `pnpm install` fails today because
`langgraph` is not a real package. Rewrite `backend/package.json` deps to
exactly:
- `dependencies`: `express@^5.2.1`, `dotenv@^17.4.2`, `pino@^10.3.1`,
  `pino-http@^11.0.0`
- `devDependencies`: `typescript@^5.3.3`, `tsx@^4.23.13`,
  `pino-pretty@^13.1.3`, `@types/express@^5.0.6`, `@types/node@^20.0.0`

`pino`/`pino-http`/`pino-pretty` are installed here even though T03 uses them,
so the lockfile is written once.

**Scripts:**
```json
"dev": "tsx watch src/index.ts",
"build": "tsc",
"start": "node dist/index.js",
"typecheck": "tsc --noEmit"
```
Delete the existing `node --loader ts-node/esm` script — it emits an
`ExperimentalWarning` on every start, which fails the epic's "no warnings"
criterion.

**`backend/tsconfig.json`:** `target: ES2022`, `module: NodeNext`,
`moduleResolution: NodeNext`, `rootDir: src`, `outDir: dist`, `strict: true`,
`noUncheckedIndexedAccess: true`, `noImplicitOverride: true`,
`forceConsistentCasingInFileNames: true`, `skipLibCheck: true`,
`sourceMap: true`, `include: ["src"]`.

**`.gitignore` at the repo root** — none exists and `pnpm install` is about to
create `node_modules/`. Must cover: `node_modules/`, `dist/`, `.next/`,
`.env`, `.env.local`, `*.log`, `.DS_Store`.

**`src/config/env.ts`** — `import 'dotenv/config'` at the top, then read and
validate:

| Var | Type | Default | Validation |
|---|---|---|---|
| `PORT` | number | `3001` | integer, 1–65535, else throw |
| `NODE_ENV` | `'development' \| 'production' \| 'test'` | `development` | must be one of the three |
| `LOG_LEVEL` | string | `info` | one of pino's levels |

Throw a plain `Error` with a clear message on invalid input (this runs before
`AppError` exists and before the logger exists — it is a boot crash, and that
is the intent). Export `export const env = Object.freeze({ ... })` with an
explicit interface, plus a derived `isDevelopment` boolean.

**`src/app.ts`** — exports `createApp(): Express`. Sets
`app.disable('x-powered-by')`, mounts `express.json({ limit: '1mb' })`. It
does **not** call `listen`. Keeping app construction separate from binding the
port is what lets T02/T03 add middleware in one obvious place, and lets tests
(E8) exercise the app without a live socket.

**`src/index.ts`** — calls `createApp()`, listens on `env.PORT`, logs
`Server listening on port ${env.PORT}` (plain `console.log` is acceptable here
*only until T03* adds the logger; T03 replaces it). Registers `SIGINT`/`SIGTERM`
handlers that call `server.close()` then `process.exit(0)`, so `tsx watch`
restarts do not leave the port bound.

**`backend/.env.example`** — committed, contains `PORT=3001`,
`NODE_ENV=development`, `LOG_LEVEL=info` with a one-line comment each.

**Verify:** `pnpm install` succeeds; `pnpm --filter backend dev` logs port
3001 with zero warnings; `PORT=4000` in `.env` moves it to 4000;
`pnpm --filter backend typecheck` is clean; `pnpm --filter backend build &&
pnpm --filter backend start` runs from `dist/` (this is what catches missing
`.js` import extensions).

Estimated diff: ~130 lines.

---

### E1-T02 — Health Check Endpoint

**`src/routes/health.route.ts`** — an `express.Router()` with `GET /`
returning `200`:
```json
{ "status": "ok", "service": "ai-chat-rag-backend", "uptime": 12.34, "timestamp": "2026-09-08T22:45:26.000Z" }
```
`uptime` from `process.uptime()`, `timestamp` from `new Date().toISOString()`.
The handler is synchronous and touches nothing else — no config beyond the
service name, no session store, no LLM. That is what makes "works immediately
after startup, no race condition" true by construction rather than by luck:
the route is mounted before `listen()` is called, so the socket does not
accept connections until it is ready.

**`src/routes/index.ts`** — the **route registry**, and the extension seam
T03's acceptance criteria refer to. Exports a single `Router` that mounts each
feature router under its prefix:
```
router.use('/health', healthRouter)
```
`app.ts` mounts this registry once. Adding a route in E4 = create
`foo.route.ts` + add one `router.use()` line here; `app.ts`, `index.ts`, and
the error middleware are never touched.

**Path decision:** `/health` sits at the **root**, not under `/api` — the epic
and plan both specify `GET /health`, and health checks conventionally live
outside the versioned API surface. `/api` stays reserved for the feature
routes in E4 (`/api/session`, etc.). Mount the registry so this holds.

**Verify:** `curl -i localhost:3001/health` → 200 + JSON, `content-type:
application/json`.

Estimated diff: ~50 lines.

---

### E1-T03 — Global Error Handling & Modular Route/Service Structure

**`src/utils/logger.ts`** — pino singleton per ADR-4: level `env.LOG_LEVEL`;
`transport: { target: 'pino-pretty' }` only when `env.isDevelopment`;
`redact: ['req.headers.authorization', 'req.headers.cookie']`.

**`src/errors/AppError.ts`**
```
class AppError extends Error
  statusCode: number
  code: string                 // SCREAMING_SNAKE_CASE
  isOperational: true
  details?: unknown
  static badRequest(message, details?)   // 400 BAD_REQUEST
  static notFound(message)               // 404 NOT_FOUND
  static internal(message)               // 500 INTERNAL_ERROR
```
Call `Error.captureStackTrace(this, AppError)` and set `this.name = 'AppError'`.

**`src/middleware/requestLogger.ts`** — `pinoHttp` configured with the shared
logger, `genReqId: () => randomUUID()` (from `node:crypto`), and
`autoLogging.ignore: (req) => req.url === '/health'`. Mounted **first** in
`app.ts`, before `express.json()`, so body-parser failures are still logged
with a request id.

**`src/middleware/notFound.ts`** — `app.use(notFoundHandler)` with **no path
string** (ADR-1: `'*'` throws in Express 5). Calls
`next(AppError.notFound(\`Route ${req.method} ${req.originalUrl} not found\`))`
so 404s flow through the same handler as everything else and get the same
envelope.

**`src/middleware/errorHandler.ts`** — signature
`(err: unknown, req: Request, res: Response, next: NextFunction)`. The
4-argument shape is what makes Express treat it as an error handler; do not
drop `next` even though it is unused in the common path. Logic, in order:
1. `if (res.headersSent) return next(err)` — cannot rewrite a started response.
2. Narrow to `AppError` → use its `statusCode`, `code`, `message`, `details`.
3. Body-parser `SyntaxError` (has a numeric `status` and `body` property) →
   `400 / INVALID_JSON / "Malformed JSON in request body"`.
4. Anything else → `500 / INTERNAL_ERROR / "An unexpected error occurred"`.
   The original message and stack are **logged, never returned** — in every
   environment, development included (ADR-5).
5. Log via `req.log` (child logger with the request id) — `warn` for 4xx,
   `error` for 5xx, including `err` and the resolved `code`.
6. Respond with the envelope, `requestId` taken from `req.id`:
   `{ error: { code, message, requestId, ...(details && { details }) } }`.

**`src/routes/dev.route.ts`** — mounted in the registry **only when
`env.isDevelopment`**. Two routes that make T03's E2E flows checkable without
adding production surface area:
- `GET /__dev/boom` → `throw new Error('boom')` (unexpected error path → 500
  generic, server stays alive)
- `GET /__dev/boom-async` → `async` handler that `await`s then throws (this is
  the case Express 4 would have hung on — it proves ADR-1)

**`src/services/.gitkeep`** plus a short "Structure" section in
`backend/README.md` stating the layering rule: **routes** parse/validate input
and shape responses; **services** hold business logic, are framework-free
(never import `express`, never see `req`/`res`), and signal failure by
throwing `AppError`. E2/E3 depend on this line being drawn now.

**`src/index.ts` additions:** replace the T01 `console.log` with
`logger.info(...)`; add `process.on('unhandledRejection')` and
`process.on('uncaughtException')` handlers that log via the logger and
`process.exit(1)` — a process in an unknown state should die loudly, not limp.

**Middleware order in `app.ts` — this is load-bearing:**
```
requestLogger  →  express.json  →  routes registry  →  notFound  →  errorHandler
```
`notFound` and `errorHandler` must be last, in that order.

**Verify:** `curl localhost:3001/__dev/boom` → 500 envelope, generic message,
no stack in the body, stack present in the log, server still serving `/health`
afterwards; same for `/__dev/boom-async`; `curl localhost:3001/does-not-exist`
→ 404 envelope; `curl -X POST localhost:3001/health -H 'content-type:
application/json' -d '{bad'` → 400 `INVALID_JSON` (not an HTML page);
`NODE_ENV=production pnpm start` → `/__dev/boom` returns 404, not 500.

Estimated diff: ~200 lines. If it runs past ~250, split as T03a (logger +
`AppError` + errorHandler + notFound) and T03b (dev routes + services layer +
README + process handlers) per the CONTRACT's reviewability rule.

---

### E1-T04 — Unit Test Coverage for Backend Foundation

**Prerequisite: E1-T03 must be merged first.** Two of the four test files
import middleware that only exists on T03's branch.

This ticket adds tests and test tooling. It changes **no** runtime behaviour and
touches exactly **one** file under `src/` (a pure seam in `env.ts`, specified
below). If the Coder finds it needs any other `src/` change to make something
testable, STOP and flag it in `questions.md` rather than reshaping T01–T03 code.

**Runner: `node:test` run through the already-installed `tsx` (ADR-8). Zero new
dependencies.** `package.json` script changes:
```json
"test": "NODE_ENV=test LOG_LEVEL=silent node --import tsx --test \"tests/**/*.test.ts\"",
"typecheck": "tsc -p tsconfig.test.json"
```
`build` stays `tsc` (emits `src` only). The new `typecheck` is a superset of the
old `tsc --noEmit` — it covers `src` *and* `tests` with `noEmit`.

`NODE_ENV=test` and `LOG_LEVEL=silent` in the script are load-bearing, not
cosmetic: `test` keeps `pino-pretty`'s worker transport out of the test process
and keeps `/__dev/*` unmounted, `silent` keeps the intentional 4xx/5xx logs off
the test output. `dotenv` never overrides an already-set variable, so a
developer's local `.env` cannot break this.

**`backend/tsconfig.test.json`** (new):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true, "rootDir": "." },
  "include": ["src", "tests"]
}
```
`rootDir: "."` is required — without it `tests/` sits outside the base
`rootDir: "src"` and `tsc` rejects it.

**The one `src/` change — a pure seam in `src/config/env.ts`.** `env` is built
at import time from `process.env`, so it cannot be exercised with different
values. Extract the existing logic (unchanged) into one exported pure function:
```ts
export function loadEnv(source: NodeJS.ProcessEnv): Env   // reads only `source`
export const env: Env = loadEnv(process.env)
```
Keep `import 'dotenv/config'` as the first statement, keep the three `parse*`
helpers private and their error messages verbatim, and keep `Object.freeze`
(now inside `loadEnv`). `loadEnv` must not read `process.env` itself. Import-time
behaviour is identical: same defaults, same fail-fast throw (ADR-3 holds).

**`tests/helpers/testServer.ts`** — the whole HTTP story, ~20 lines, no
`supertest`:
```ts
startTestServer(app: Express): Promise<{ url: string; close: () => Promise<void> }>
```
`app.listen(0)`, await the `listening` event, narrow `server.address()` (it is
`string | AddressInfo | null` — `strict` forces this), return
`http://127.0.0.1:${port}` and a promisified `server.close()`. Call it in
`before` and always `await close()` in `after` — a leaked listener makes
`node --test` hang instead of failing.

#### Covers E1-T01 — `tests/config/env.test.ts` (pure, no HTTP)
- `loadEnv({})` → `PORT: 3001`, `NODE_ENV: 'development'`, `LOG_LEVEL: 'info'`,
  `isDevelopment: true`.
- `loadEnv({ PORT: '4000' })` → `PORT` is the **number** `4000` — this is the
  AC's "`PORT` env override".
- `loadEnv({ PORT: '' })` → `3001` (empty string means unset).
- Invalid `PORT` — `'abc'`, `'0'`, `'65536'`, `'3001.5'`, `'-1'` — each
  `assert.throws(..., /Invalid PORT/)`.
- `NODE_ENV: 'production'` and `'test'` → `isDevelopment: false`;
  `'staging'` throws `/Invalid NODE_ENV/`.
- `LOG_LEVEL: 'silent'` accepted; `'verbose'` throws `/Invalid LOG_LEVEL/`.
- Result is frozen: `Object.isFrozen(...) === true`.
- Smoke: the real `env` export imports cleanly and `typeof env.PORT === 'number'`.

#### Covers E1-T02 + T03 wiring — `tests/app.test.ts` (real `createApp()`)
One server per file, started in `before` on port 0.
- `GET /health` → `200`; `content-type` includes `application/json`.
- Body key set is **exactly** `['service', 'status', 'timestamp', 'uptime']`
  (compare sorted `Object.keys`) — so adding *or* dropping a field fails the
  test. `status === 'ok'`, `service === 'ai-chat-rag-backend'`,
  `typeof uptime === 'number'`, and `timestamp` round-trips:
  `new Date(body.timestamp).toISOString() === body.timestamp`.
- Two sequential `GET /health` both `200` — the AC's "works immediately, no
  dependency on other features". A genuine cold-start race is process-level and
  belongs to E8 (see *Out of scope*).
- `GET /does-not-exist` → `404`, `error.code === 'NOT_FOUND'`, `error.message`
  contains `GET /does-not-exist`, `error.requestId` is a non-empty string, and
  the raw response text contains no `stack`.
- `DELETE /health` (known path, unknown method) → `404 NOT_FOUND` — proves the
  terminal handler catches more than a mistyped path.
- `POST /health` with `content-type: application/json` and body `'{bad'` →
  `400`, `error.code === 'INVALID_JSON'`, and the body parses as JSON (not
  Express's default HTML error page).
- `x-powered-by` response header is absent.
- `GET /__dev/boom` → `404`, proving the dev routes are env-gated and never
  reachable outside `development`.

#### Covers E1-T03 — `tests/middleware/errorHandler.test.ts` (harness app)
`errorHandler` needs `req.log`/`req.id` from `requestLogger`, and the dev
throwing routes are unmounted at `NODE_ENV=test`. So this file builds a minimal
app from the **real** middleware in the **real** order —
`requestLogger → express.json() → test routes → notFoundHandler → errorHandler`
— and registers its own throwing routes plus one `GET /ok`. (The real app's
ordering is separately proven by `app.test.ts`'s 404 and `INVALID_JSON` cases.)
- Sync `throw new Error('boom: leaked secret')` → `500`,
  `code INTERNAL_ERROR`, message exactly `'An unexpected error occurred'`, and
  the raw text does **not** contain `'leaked secret'` or a stack frame — ADR-5's
  "logged, never returned, in every environment".
- `async` handler that `await`s then throws → the same `500` envelope, and the
  request *resolves* rather than hanging (the ADR-1 Express 5 guarantee).
- Route throwing `AppError.badRequest('bad thing', { field: 'x' })` → `400`,
  `code BAD_REQUEST`, message passed through, `details` deep-equal to
  `{ field: 'x' }`.
- Route calling `next(AppError.notFound('nope'))` → `404` and the `details` key
  is **absent** from the envelope (the conditional spread).
- Route throwing a non-`Error` (`throw 'plain string'`) → still the generic
  `500` envelope, no crash.
- `headersSent`: a route that sends a `200` and *then* throws → the sent
  response is not rewritten into an error envelope. Keep this assertion narrow;
  if it proves flaky, assert only that the following request still succeeds.
- Final `GET /ok` → `200`, after all the above — the "server stays running" AC.

#### Covers E1-T03 — `tests/errors/AppError.test.ts`
Each factory (`badRequest` / `notFound` / `internal`) sets the right
`statusCode` + `code`, preserves `message`, leaves `details` `undefined` unless
passed, and every instance has `isOperational === true`, `name === 'AppError'`,
`instanceof Error`, and a string `stack`.

**`backend/README.md`** — add a short `## Testing` section: `pnpm test`, tests
live in `tests/` mirroring `src/`, assertions are `node:assert/strict`
(`assert.equal`, **not** `expect`), and every backend ticket ships tests from
now on (link ADR-7 and ADR-8).

**Out of scope for T04 — flag for E8 (testing epic):**
- Spawning `src/index.ts` as a child process to assert it binds the real
  `env.PORT`, logs the startup line, and exits cleanly on `SIGINT`/`SIGTERM`,
  plus the `unhandledRejection` / `uncaughtException` → `exit(1)` handlers.
  Those are process-level tests, not unit tests.
- Asserting log *output*. pino is silenced here. If a later ticket must assert
  logging, inject a pino instance with a custom destination — never parse stdout.
- Exercising `/__dev/*` under real `NODE_ENV=development` (it would spawn a
  `pino-pretty` worker); the harness covers the identical code path.
- Coverage tooling or a percentage threshold — deliberately none (ADR-7).

**Verify:** `pnpm --filter backend test` → all pass, exit code 0, and the
process **exits** (a hang means a socket was not closed);
`pnpm --filter backend typecheck` clean; `pnpm --filter backend build` then
confirm `dist/` contains no `tests/`; temporarily change health's `status` to
`'up'` → health test fails; temporarily remove `app.use(notFoundHandler)` →
404 tests fail; revert both.

Estimated diff: ~200 lines (~170 test code, ~10 in `env.ts`, the rest config,
scripts and README). If it runs past ~250, split as T04a (tooling + `env` +
`AppError` tests) and T04b (`app` + `errorHandler` tests).

## Data / Schema Changes
None. No persistence layer this sprint (in-memory only, per `CLAUDE.md`), and
no in-memory stores yet either — session state arrives in E4.

## API / Interface Changes

**New public HTTP surface:**

| Method | Path | Status | Response body |
|---|---|---|---|
| `GET` | `/health` | 200 | `{ status, service, uptime, timestamp }` |
| any | any unmatched path | 404 | error envelope, `code: "NOT_FOUND"` |
| `GET` | `/__dev/boom`, `/__dev/boom-async` | 500 | error envelope, `code: "INTERNAL_ERROR"` — **development only** |

**Error envelope (applies to every non-2xx response, all future endpoints):**
```json
{ "error": { "code": "NOT_FOUND", "message": "Route GET /nope not found", "requestId": "3f1c...", "details": null } }
```
`details` omitted unless present. `code` values introduced this sprint:
`NOT_FOUND`, `INVALID_JSON`, `INTERNAL_ERROR`.

**E1-T04 changes no HTTP surface at all** — no new route, no new status code, no
change to the envelope. Its only interface addition is the internal `loadEnv`
export below.

**Internal interfaces later epics build on:**
- `createApp(): Express` — `src/app.ts`
- `env` (frozen, typed) + `isDevelopment` — `src/config/env.ts`
- `loadEnv(source: NodeJS.ProcessEnv): Env` — `src/config/env.ts` (T04; pure,
  for tests. Application code keeps importing `env`, never calls `loadEnv`.)
- `startTestServer(app)` — `tests/helpers/testServer.ts` (T04; test-only)
- `logger` — `src/utils/logger.ts`; `req.log` inside requests
- `AppError` + `.badRequest()` / `.notFound()` / `.internal()` — `src/errors/AppError.ts`
- Route registry — `src/routes/index.ts`

## Cross-sprint flags
Decisions here that constrain later sprints — read before starting E2+.

1. **Express 5 (ADR-1).** E4 must use Express 5 path syntax: no `'*'` routes;
   wildcards are `/*splat`; optional params `:id?` are gone. Async handlers
   throw directly — no `asyncHandler` wrapper anywhere.
2. **`.js` import extensions (ADR-2).** Applies to every backend file added in
   every future epic.
3. **`@langchain/langgraph`, not `langgraph` (ADR-6).** The scaffolded name was
   invalid. E2/E3 add their own deps in their first ticket, versions verified
   against the registry then.
4. **Every new error is an `AppError` with a new `code`** (ADR-5). E2/E3/E4
   extend the code vocabulary; they do not invent new response shapes. Likely
   additions: `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`,
   `DOCUMENT_LIMIT_EXCEEDED`, `SESSION_NOT_FOUND`, `LLM_UNAVAILABLE`.
5. **CORS is deliberately not configured this sprint.** No AC requires it and
   nothing calls the API yet. The frontend on `:3000` calling the backend on
   `:3001` **will** be blocked by the browser — E5 (or the first E4 ticket the
   frontend consumes) must add `cors` restricted to the frontend origin. Do
   not discover this mid-integration in E8.
6. **Streaming (E7) bypasses the error envelope after the first byte.** Once a
   chat response starts streaming, headers are sent and `errorHandler`
   delegates to Express (ADR-5 step 1). E3/E7 must design an in-stream error
   event; it cannot be retrofitted onto this middleware.
7. **Services must stay framework-free.** E2's chunking/embedding and E3's
   LangGraph orchestration go in `src/services/`, importing no `express` types.
   This is what makes E8's testing epic tractable.
8. **Rate limiting stays deferred** (plan's Out of Scope). Revisit when the
   OpenAI key is live in E3 — an unauthenticated PoC endpoint that spends money
   per request is the point where this stops being premature.
9. **Tests are part of every backend ticket's Definition of Done from now on
   (ADR-7).** E2/E3/E4 tickets ship their test files in the *same* PR as the
   code, under `backend/tests/` following T04's layout, and the Reviewer treats
   a missing test as a finding. Plan estimates should assume roughly +30–60
   lines of tests for a typical route or service. Frontend policy is unchanged
   (no tests required); E5+ needs its own ADR for that.
10. **One test runner: `node:test` + `tsx` (ADR-8).** Do not add vitest, jest,
    chai, or `supertest` in a later epic. Assertions are `node:assert/strict`
    (`assert.equal`, not `expect`). There is no `vi.mock` equivalent, so
    **E3 must inject its LLM/LangChain client** (constructor or factory
    argument) instead of relying on module interception — decide that in E3's
    design, not while writing its tests.
11. **Testability is now a design constraint.** Anything read at import time
    (`process.env`, the clock, a network client) must also be reachable through
    a pure, injectable seam — as `loadEnv` now is for `env`. Designing an E2/E3
    module that can only be exercised by booting the whole app is a design bug
    under ADR-7.
12. **E8 is narrowed, not cancelled.** Per-ticket unit tests now cover route and
    service behaviour, so E8 owns what they cannot: process-level tests
    (real port binding, signal shutdown, `uncaughtException` exit), and full
    upload → chunk → retrieve → answer integration/E2E flows.
