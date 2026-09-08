# ADR-6: Defer RAG dependencies to the epics that use them

- **Status:** Accepted
- **Date:** 2026-09-08
- **Sprint / Tickets:** Sprint 1 — E1-T01

## Context
`backend/package.json` was scaffolded with `langchain`, `langgraph`,
`pdf-parse` and `openai` before any of them are used. One of them does not
exist:

```
$ npm view langgraph version
npm error 404 Not Found - GET https://registry.npmjs.org/langgraph
```

The published package is `@langchain/langgraph`. As it stands, `pnpm install`
in `backend/` **fails outright**, which blocks E1-T01 before a line of server
code is written. This is not a hypothetical cleanup — it is the first thing
that breaks.

## Decision
Reduce `backend/package.json` to the dependencies E1 actually uses:

- `dependencies`: `express`, `dotenv`, `pino`, `pino-http`
- `devDependencies`: `typescript`, `tsx`, `pino-pretty`, `@types/express`,
  `@types/node`

Remove `langchain`, `langgraph`, `pdf-parse`, `openai`, and `ts-node`. Each
returns in the epic that first imports it, added with a version verified
against the registry at that time:

| Package | Correct name | Added in |
|---|---|---|
| pdf-parse | `pdf-parse` | E2 (document processing) |
| langchain | `langchain` + `@langchain/textsplitters` | E2 |
| langgraph | **`@langchain/langgraph`** | E3 (RAG engine) |
| openai | `openai` or `@langchain/openai` | E3 |

## Consequences
- `pnpm install` works, unblocking E1-T01.
- A dependency present in `package.json` means "something imports this",
  which keeps the lockfile and the install surface honest.
- **Affects later sprints:** E2 and E3 must add their own dependencies as part
  of their first ticket, and must use `@langchain/langgraph` — the placeholder
  name in the original scaffold was wrong and should not be copied forward.
- `ts-node` is removed as part of ADR-2 (replaced by `tsx`).

## Alternatives rejected
- **Fix `langgraph` → `@langchain/langgraph` and keep everything installed.**
  Unblocks the install, but pins LangChain/LangGraph/OpenAI versions months
  before the code that uses them is written, and installs a heavy dependency
  tree that E1 never touches.
