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
- LangChain / LangGraph / pdf-parse / OpenAI — added in later epics (see
  `docs/adr/ADR-6.md`), not installed yet.

## API Endpoints
See CLAUDE.md for full endpoint specifications.
