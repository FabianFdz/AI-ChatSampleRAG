# Architecture

Last updated: Sprint 2 (E2 — Document Processing Pipeline). Frontend and the
RAG engine (E3+) described in `CLAUDE.md` are not built yet; this file
documents what actually exists in the repo today.

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
- **Document chunking:** LangChain's `RecursiveCharacterTextSplitter`
  (`@langchain/textsplitters` + `@langchain/core`), `splitText` only, our own
  typed `Chunk` shape rather than LangChain's `Document`
  ([ADR-9](adr/ADR-9.md)).
- **PDF extraction:** `pdf-parse` v2's `PDFParse` class API
  ([ADR-10](adr/ADR-10.md)).
- **RAG orchestration dependencies** (LangGraph, `@langchain/anthropic`,
  Voyage AI) are deliberately not installed yet — added in E3 when first used
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
- **`src/services/`** — a framework-free layer (no `express` imports, no
  `req`/`res`) for business logic; it signals failure by throwing `AppError`.
  Holds the document processing pipeline as of E2 (below).

### Error envelope

Every non-2xx response, present and future, uses this shape:
```json
{ "error": { "code": "NOT_FOUND", "message": "Route GET /nope not found", "requestId": "3f1c...", "details": null } }
```
`details` is omitted when absent. Codes introduced so far: `NOT_FOUND`,
`INVALID_JSON`, `INTERNAL_ERROR`. Later epics add codes, never a new response
shape (`AppError` is the only way to produce an error response).

## Document processing pipeline (E2)

No HTTP surface yet — this is a framework-free service layer in
`src/services/`, called directly by tests today and by E4's upload route
later. Two entry points are the only things a caller should ever use:

- **`processPastedText(text)`** and **`processFile({ filename, content, mimeType? })`**
  (`documentPipeline.service.ts`) — each resolves to a `ProcessedDocument`
  (`{ document, chunks }`). They wrap ingest → chunk → validate as one
  sequence, so validation can never be skipped and a mid-pipeline failure can
  only surface as a rejected promise (never a partial result). `processFile`
  routes on the lower-cased filename extension first, falling back to MIME
  type only when the extension is absent/unrecognised: `.pdf`/PDF MIME → the
  PDF path; `.txt`/`.md`/any `text/*` MIME → the text path; anything else →
  `UNSUPPORTED_FILE_TYPE` (415).
- **`ingestText(input)`** (`textIngestion.service.ts`, sync) — normalizes
  pasted text or a `.txt` file's bytes into a `NormalizedDocument`: strips a
  BOM, normalizes line endings to LF, trims, and rejects empty/whitespace-only
  input. Also exports `normalizeText`, reused per-page by PDF ingestion.
- **`ingestPdf(input)`** (`pdfIngestion.service.ts`, async) — extracts text via
  `pdf-parse` v2 (`PDFParse` class, `getText()`), one segment per PDF page
  (page-free pages kept, never dropped), into the same `NormalizedDocument`
  shape.
- **`chunkDocument(document)`** (`chunking.service.ts`, async) — splits each
  document *segment* independently with LangChain's
  `RecursiveCharacterTextSplitter` (1000 chars / 200 overlap, an upper bound —
  see ADR-9), producing a document-wide contiguous list of `Chunk`s. Page
  attribution comes from the segment, never from inspecting chunk text.
- **`validateChunks(documentId, chunks)`** (`chunkValidation.service.ts`,
  sync) — throws on a metadata/invariant violation (our own bug, not user
  input), filters empty/whitespace-only chunks, and renumbers survivors so a
  chunk's `index` always equals its position in the returned array.

**Shared shapes** (`document.types.ts`) — `NormalizedDocument` (`id`, `title`,
`sourceType`: `'pasted-text' | 'text-file' | 'pdf'`, ordered `segments`, full
`text` for display only, `pageCount`, `charCount`, `uploadedAt`) and `Chunk`
(`id`, `documentId`, `index`, `text`, `metadata`). A `DocumentSegment` is one
page's text plus its 1-based `pageNumber` (`null` for non-PDF sources — never
a synthetic page 1). Chunking always reads `segments`, never `document.text`
(ADR-11) — this is what keeps page attribution exact without offset
bookkeeping. All shapes are plain JSON-serialisable data (no classes, no
`Buffer`, no `Date`), so E4 can return them from a route unmapped.

**New `AppError` codes** (`documentErrors.ts`, one factory per code):
`EMPTY_DOCUMENT` (400), `DOCUMENT_TOO_LARGE` (413, cap is
`DOCUMENT_PROCESSING.maxDocumentBytes` = 10MB), `UNSUPPORTED_FILE_TYPE` (415),
`PDF_PARSE_FAILED` (400, underlying pdfjs error logged, only its `name`
crosses the boundary), `CHUNK_VALIDATION_FAILED` (500),
`DOCUMENT_PROCESSING_FAILED` (500, generic non-`AppError` wrapper). All render
through the existing ADR-5 error envelope — no new response shape.

See [ADR-9](adr/ADR-9.md) (chunking library/strategy), [ADR-10](adr/ADR-10.md)
(pdf-parse v2 API) and [ADR-11](adr/ADR-11.md) (segment-based document model)
for the full reasoning.

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

See sprint 1's and sprint 2's `design.md` "Cross-sprint flags" (archived at
`.claude/handoffs/sprint-1/design.md` and `.claude/handoffs/sprint-2/design.md`)
for the full list; the ones most likely to bite:
- Express 5 path syntax only (no `'*'`, wildcards are `/*splat`).
- Relative imports need a `.js` extension even though files are `.ts`
  (`NodeNext` module resolution).
- CORS is not configured yet — the frontend (`:3000`) calling the backend
  (`:3001`) will be blocked by the browser until E5/E4 adds `cors`.
- Services must stay framework-free so they remain unit-testable without
  booting an HTTP server.
- `node:test` has no `vi.mock`-style module interception; later epics that
  need to swap out a collaborator (e.g. E3's LLM client) must inject it.
- **E4 must call only `processPastedText`/`processFile`**, never `ingestPdf`
  + `chunkDocument` by hand — validation is wired into the pipeline and
  bypassing it bypasses the ticket's acceptance criteria.
- **E4's upload middleware must import `DOCUMENT_PROCESSING.maxDocumentBytes`**
  rather than re-typing 10MB, so an oversized upload is rejected before being
  fully buffered in memory.
- **`pageNumber` is `number | null`** everywhere (E3 retrieval/citations, E6
  UI) — pasted/plain text has no pages; never default it to page 1.
- **`Chunk` is our own type, not LangChain's `Document`.** E3 converts at the
  embedding boundary, in one place, so LangChain's untyped metadata stays
  contained (ADR-9).
- **`@langchain/core@^1.2.9` is now pinned.** E3 adds `@langchain/langgraph`,
  `@langchain/anthropic` (`ChatAnthropic`, for Claude LLM calls through
  LangGraph), and a Voyage AI client (embeddings — Claude has no embeddings
  endpoint) at compatible versions, never the `langchain` meta-package.
- **Chunk size/overlap (1000/200) are fixed constants and overlap is an upper
  bound, not a guarantee** (ADR-9) — no overlap across a PDF page boundary
  (ADR-11). If E3 sees poor retrieval quality or answers cut off at page
  breaks, the fix is a design change to `DOCUMENT_PROCESSING`, not a prompt
  tweak.
- **`pdf-parse` pulls a native binary** (`@napi-rs/canvas`). Confirm
  `pnpm install` succeeds on any new CI/container architecture; `unpdf` is the
  verified fallback (ADR-10).

## Not built yet

- Embeddings, vector search, LangGraph RAG orchestration (E3)
- `/api/session*` endpoints, including document upload HTTP wiring and the
  three-documents-per-session rule (E4)
- Frontend — onboarding + chat UI (E5–E7)
- Integration/E2E testing (E8)
