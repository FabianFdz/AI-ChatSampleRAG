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
- **Prove a tooling choice by running it against the real source before
  designing on it.** Write a throwaway file under the package, run the exact
  command the design will prescribe, then delete it. This is how the
  `node --import tsx --test` + `tsconfig.test.json` (`rootDir: "."`) design was
  settled instead of guessed — the `.js`-specifier resolution, `noEmit`
  rootDir error, and clean process exit are all things a plausible-looking
  design gets wrong.
- **Modules with import-time side effects need a pure seam before they can be
  tested.** `config/env.ts` reads `process.env` at import; `utils/logger.ts`
  spawns a `pino-pretty` worker when `isDevelopment`. Design the injectable
  function (`loadEnv(source)`) rather than letting the Coder reach for module
  cache tricks, and set `NODE_ENV=test`/`LOG_LEVEL=silent` in the test script
  so env-gated code (`/__dev/*` routes, pretty transport) stays out.
- **Process/policy decisions get their own ADR, separate from the ticket design
  that implements them.** A testing mandate, a review rule or a dependency
  policy is a durable "why" that outlives the sprint; the ticket section in
  `design.md` is just the "how" for one Coder run.
- **A ticket added mid-sprint gets a second design PR cut from `main`.** Do not
  branch off the in-flight ticket branch (its code would land in the design
  PR) and do not re-open earlier ticket designs. Expect a small `status.json`
  conflict with the open ticket PR and say so in the PR body.
