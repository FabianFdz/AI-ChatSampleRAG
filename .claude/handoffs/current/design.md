# Sprint 1 Design — tickets E1-T01, E1-T02, E1-T03

## Tickets in Scope
- **E1-T01** — Express Server Bootstrap
- **E1-T02** — Health Check Endpoint
- **E1-T03** — Global Error Handling & Modular Route/Service Structure

Build them in that order; each assumes the previous is merged.

## ADRs produced
| ADR | Decision |
|---|---|
| [ADR-1](../../../docs/adr/ADR-1.md) | Express 5, not Express 4 (native async error propagation) |
| [ADR-2](../../../docs/adr/ADR-2.md) | `tsx` dev runtime, ESM + `module: NodeNext` |
| [ADR-3](../../../docs/adr/ADR-3.md) | Single typed, fail-fast env config module |
| [ADR-4](../../../docs/adr/ADR-4.md) | `pino` + `pino-http` structured logging |
| [ADR-5](../../../docs/adr/ADR-5.md) | `AppError` + one JSON error envelope |
| [ADR-6](../../../docs/adr/ADR-6.md) | Defer unused RAG dependencies to E2/E3 |

## Rules that apply to all three tickets
1. **Relative imports end in `.js`** — `import { env } from './config/env.js'`
   even though the file is `env.ts`. Required by `NodeNext` (ADR-2). Getting
   this wrong breaks `pnpm start` while `pnpm dev` still works, so it will not
   be caught by running the dev server.
2. **No `any`**, no `@ts-ignore`, no non-null `!` assertions. `strict` is on.
3. **`process.env` is read only in `src/config/env.ts`** (ADR-3).
4. **No `console.*`** in application code; use the logger (ADR-4).
5. Do not add packages beyond those listed per ticket. Do not add `cors`,
   `helmet`, `zod`, or a rate limiter this sprint — see *Cross-sprint flags*.

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
├── .env.example                    # T01 (committed)
├── tsconfig.json                   # T01
└── package.json                    # T01
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

**Internal interfaces later epics build on:**
- `createApp(): Express` — `src/app.ts`
- `env` (frozen, typed) + `isDevelopment` — `src/config/env.ts`
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
