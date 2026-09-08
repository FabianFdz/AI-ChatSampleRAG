# Architect Memory — ai-chat-rag

## Rules

- **Verify every scaffolded dependency against the registry before designing
  around it.** This repo's `package.json` files were written by hand before
  any code existed and contain packages that do not exist (`langgraph` 404s;
  the real one is `@langchain/langgraph`). Run `npm view <pkg> version` for
  anything the sprint will actually install.
- **Check whether the thing you are designing on top of exists at all.** The
  backend had `package.json` + `README.md` and nothing else — no `tsconfig`,
  no `src/`. Scaffold-shaped repos look further along than they are.
- **`CLAUDE.md` says "PoC, no premature optimization" — treat it as a real
  constraint.** Justify each dependency against an acceptance criterion, and
  record the rejected simpler option in the ADR. Prefer hand-rolled over a
  library below ~30 lines of equivalent code (env validation), prefer the
  library when hand-rolling would be larger and worse (logging).
- **Backend is ESM (`"type": "module"`).** Any design touching backend files
  must state the `.js`-extension import rule explicitly — it breaks `pnpm
  start` while `pnpm dev` keeps working, so the Coder will not notice it.
- **The epic files' "To settle" list is the ADR backlog.** Each unresolved
  item there (port config, logging, error format, rate limiting) becomes an
  ADR or an explicit deferral in the design, not an implicit Coder choice.
- **Flag cross-sprint constraints in a dedicated `design.md` section.** This
  project's epics are tightly chained (E1 unblocks E2/E3/E4), and choices
  like framework major version or error envelope shape are expensive to
  reverse two epics later.
