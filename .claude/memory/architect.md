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
- **Measure the library behaviour an AC assumes before writing the AC into a
  design.** Plan text like "~200-character overlap" or "chunks of 1000 chars"
  describes an *intent*; the library delivers something more specific.
  `RecursiveCharacterTextSplitter` gives ~197 chars of overlap inside a
  paragraph and **0** across a `\n\n` boundary, and returns `[]` for empty
  input — so a test written from the plan's wording fails against correct code,
  and a "filter empty chunks" branch is unreachable end-to-end. Run the real
  package on real fixtures, put the measured table in the ADR, and tell the
  Reviewer which literal reading of the AC not to enforce.
- **A scaffolded library name may be a different package by the time you use
  it.** ADR-6 deferred `pdf-parse` to E2; by then v2 was a full rewrite (class
  API, per-page results, ESM, bundled types) and every tutorial and most
  training data still shows v1's `pdfParse(buffer)`. Check the major version
  and its `exports`/`.d.ts`, then say in the design which API shape is wrong,
  so the Coder recognises a v1 snippet as a defect.
- **Decide how metadata survives a transformation, don't leave it to the
  Coder.** Splitters/parsers return bare strings, so page/offset provenance is
  lost unless the design fixes the carrier (here: per-page `segments` chunked
  independently). Also check whether adopting the library's own container type
  costs `any` — LangChain's `Document.metadata` is `Record<string, any>`, which
  is enough reason to keep a project-owned type and convert at the boundary.
- **Making an env var *required* breaks every test, not just the new ticket's.**
  `config/env.ts` validates at import time and `app.test.ts` reaches it
  transitively (`app.ts` -> `routes/index.ts` -> `config/env.ts`), so the sprint
  that adds a required key (`VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`) must also add
  placeholder values to the `test` script in `package.json`. Prescribe that in
  the same ticket — never a `NODE_ENV`-conditional branch inside `env.ts`, which
  would make test and production validate differently.
- **When a ticket must be retrofitted onto already-merged tickets, design the
  seam into the earlier ones.** A guardrail/decorator ticket sequenced last only
  stays a small diff if the earlier tickets already route through one
  construction site with the needed parameter threaded through (unused for now).
  Say explicitly in `design.md` that the unused parameter is intentional, or the
  Reviewer flags it as dead code.
- **Before writing ADRs, check `git status` for uncommitted ones.** An
  interrupted run can leave ADRs on disk with no `design.md`, no handoff and
  `status.json` still `pending`. Read what is there and build on it rather than
  renumbering over it.
- **A ticket added mid-sprint gets a second design PR cut from `main`.** Do not
  branch off the in-flight ticket branch (its code would land in the design
  PR) and do not re-open earlier ticket designs. Expect a small `status.json`
  conflict with the open ticket PR and say so in the PR body.
