# AI Chat RAG

A Proof-of-Concept RAG (Retrieval-Augmented Generation) app: upload up to 3
documents and chat with an AI that answers from their content. In-memory
storage only, single session at a time — see the root
[`CLAUDE.md`](../CLAUDE.md) for the full product/architecture guide agents
work from.

## Status

- **E1 — Backend Foundation: done.** Express server, health check, global
  error handling, modular route/service structure, and unit test coverage are
  all shipped and merged. See
  [`docs/sprint-history/sprint-1.md`](sprint-history/sprint-1.md).
- Everything else (document processing, RAG engine, API endpoints, frontend)
  is still `pending`/`planning` — see
  [`docs/epics/epic-status.md`](epics/epic-status.md) for the live dashboard.

## Repo layout

```
ai-chat-rag/
├── backend/            # Node.js/TypeScript/Express API
│   ├── src/            # application code
│   └── tests/          # node:test unit tests, mirrors src/
├── frontend/            # Next.js app (not started yet — E5+)
├── docs/
│   ├── README.md        # this file
│   ├── architecture.md  # current architecture, updated every sprint
│   ├── adr/             # Architecture Decision Records
│   ├── epics/           # epic definitions + epic-status.md dashboard
│   └── sprint-history/  # release notes per sprint
└── CLAUDE.md             # project/agent guide (stack, conventions, decisions)
```

## Getting started (backend)

```sh
cd backend
pnpm install
cp .env.example .env    # adjust PORT / NODE_ENV / LOG_LEVEL if needed
pnpm dev                 # tsx watch, http://localhost:3001
```

Other backend scripts:
- `pnpm build` — `tsc` compile to `dist/`
- `pnpm start` — run the compiled build
- `pnpm typecheck` — typecheck `src/` and `tests/`
- `pnpm test` — run the unit test suite (`node:test` via `tsx`)

Verify the server is up:
```sh
curl -i localhost:3001/health
```

The frontend has not been started yet (planned in epic E5).

## Documentation map

- **[architecture.md](architecture.md)** — how the backend is put together
  today: request flow, error handling, config, logging, testing.
- **[adr/](adr/)** — one file per significant decision (why Express 5, why
  `node:test` instead of vitest/jest, why tests are now mandatory, etc.).
  Read these before changing anything they cover.
- **[epics/epic-status.md](epics/epic-status.md)** — dashboard of every epic's
  status and dependencies. Each `E{n}-*.md` file is that epic's scope and
  acceptance criteria.
- **[sprint-history/](sprint-history/)** — one file per closed sprint: what
  shipped, decisions made, known carry-overs.
