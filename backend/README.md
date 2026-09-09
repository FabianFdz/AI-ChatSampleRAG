# Backend - AI Chat RAG

Node.js/TypeScript server for the RAG application.

## Setup
```sh
pnpm install
cp .env.example .env   # adjust PORT / NODE_ENV / LOG_LEVEL if needed
pnpm dev                # tsx watch, http://localhost:3001
```

Other scripts: `pnpm build` (tsc → `dist/`), `pnpm start` (runs the build),
`pnpm typecheck` (tsc --noEmit).

## Key Dependencies
- Express 5 (HTTP server)
- pino / pino-http (structured logging)
- LangChain / LangGraph / pdf-parse / `@langchain/anthropic` / Voyage AI —
  added in later epics (see `docs/adr/ADR-6.md`), not installed yet.

## API Endpoints
See CLAUDE.md for full endpoint specifications.

## Testing
```sh
pnpm test        # node:test via tsx, tests/**/*.test.ts
pnpm typecheck    # tsc -p tsconfig.test.json (covers src + tests)
```
Tests live in `tests/`, mirroring `src/` one-to-one. Assertions use
`node:assert/strict` (`assert.equal`, `assert.deepEqual`, `assert.throws`
— **not** `expect`); there is no jest/vitest global in this project
(see [ADR-8](../docs/adr/ADR-8.md)). Every backend ticket ships its tests in
the same PR as its code, from this sprint onward
(see [ADR-7](../docs/adr/ADR-7.md)).

## Structure
- **`routes/`** parse/validate input and shape HTTP responses. One
  `*.route.ts` file per feature, exporting a default `Router`, wired into
  `routes/index.ts` (the route registry) — `app.ts` and the error-handling
  middleware are never touched to add a route.
- **`services/`** hold business logic. They are framework-free — never
  import `express`, never see `req`/`res` — and signal failure by throwing
  `AppError` (`src/errors/AppError.ts`), not by returning error objects.
- Errors thrown anywhere in a route or service reach the centralized error
  handler (`src/middleware/errorHandler.ts`) automatically; do not `try/catch`
  and format responses locally.
