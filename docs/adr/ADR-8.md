# ADR-8: Backend tests run on `node:test` + `tsx`, with no new dependencies

- **Status:** Accepted
- **Date:** 2026-09-09
- **Sprint / Tickets:** Sprint 1 — E1-T04

## Context
ADR-7 makes unit tests mandatory for backend tickets, so the backend needs a
test runner. The constraints it has to satisfy:

- The backend is **ESM** (`"type": "module"`) with `module: NodeNext`, so
  relative imports are written with a `.js` extension while the files are
  `.ts` (ADR-2). Any runner must resolve `./config/env.js` → `config/env.ts`.
- TypeScript is `strict` with `noUncheckedIndexedAccess`. Test files must be
  typechecked too, or they become the one place `any` leaks in.
- `CLAUDE.md`: PoC, no premature optimization. The repo already carries a
  dependency-hygiene rule (ADR-6): a package in `package.json` means something
  imports it.
- The interesting assertions are HTTP-shaped (status codes, the ADR-5 error
  envelope), so the runner has to cope with starting an Express app.

Node is v24 locally, so `node:test` (stable since Node 20) and global `fetch`
are both available without flags.

## Decision
Run backend tests with **Node's built-in test runner, loaded through the
`tsx` that is already a devDependency**:

```json
"test": "NODE_ENV=test LOG_LEVEL=silent node --import tsx --test \"tests/**/*.test.ts\""
```

- Assertions come from `node:assert/strict`; structure from `node:test`
  (`describe` / `it` / `before` / `after`).
- HTTP is exercised by binding the app to **port 0** (ephemeral) and calling it
  with global `fetch`, via a ~20-line `tests/helpers/testServer.ts`. No
  `supertest`.
- Test files live in `backend/tests/`, mirroring `src/`, and are typechecked by
  a `tsconfig.test.json` that extends the base config with
  `include: ["src", "tests"]` and `noEmit`. `pnpm build` keeps
  `include: ["src"]`, so tests never land in `dist/`.
- **Net new dependencies: zero.**

This was verified end-to-end against the real E1-T01/T02/T03 source before
being written down: `.js`-specifier resolution, the error envelope over
`fetch`, malformed-JSON handling, and a clean process exit all work, and
`tsc -p tsconfig.test.json` passes while `tsc` still emits `src` only.

`NODE_ENV=test` in the script is deliberate and load-bearing: it keeps
`pino-pretty` (a worker-thread transport) out of the test process and keeps the
dev-only `/__dev/*` routes unmounted, so tests observe the production wiring.
`dotenv` never overrides an already-set variable, so a developer's local `.env`
cannot change this.

## Consequences
- Tests are runnable by one command with nothing to install beyond what the
  server already needs, which is what makes ADR-7 cheap enough to hold.
- `describe`/`it` are familiar, but the assertion API is `assert.equal` /
  `assert.deepEqual` / `assert.match`, **not** `expect(...)`. Coders (and
  future epics) must not reach for Jest/Chai idioms.
- No built-in module mocking comparable to `vi.mock`. `node:test` offers
  `mock.fn()` and `t.mock.method()`, which cover mocking a method on an
  injected object — enough given that services are framework-free and receive
  their collaborators (cross-sprint flag 7). **E3's LangChain/Claude work must
  inject its LLM client rather than rely on module interception.** If
  module-level mocking becomes genuinely unavoidable, revisit this ADR — do not
  add a second runner alongside it.
- Watch mode is `node --test --watch`; it is not scripted in `package.json`
  until someone actually wants it.
- The inline `NODE_ENV=test` prefix is POSIX-shell syntax and will not work in
  Windows `cmd`. Acceptable (macOS/Linux development); switch to `--env-file`
  or `cross-env` only if a Windows contributor appears.
- Frontend tests are out of scope (ADR-7) and this runner does not decide them.
  A Next.js/React component stack needs a DOM and will make its own choice.

## Alternatives rejected
- **Vitest.** The most likely default: `expect`, real module mocking, watch
  mode, TS + ESM out of the box, and Vite already resolves `.js` → `.ts`. It
  loses on cost — one dependency with a large transitive tree (Vite, esbuild,
  rollup) plus a config file — for capabilities E1-T04 does not need. This is
  the "prefer the library when hand-rolling would be worse" trade-off from
  ADR-3/ADR-4 landing on the other side: here the built-in *is* the smaller
  and better option. Revisit if module mocking or snapshot testing becomes
  necessary in E3.
- **Jest + ts-jest.** Heaviest option, and its ESM support is still the
  awkward part of the stack. Nothing recommends it here.
- **`node --test` with Node's own type stripping (no `tsx`).** Tempting — even
  fewer moving parts — but Node's type stripping does not rewrite `.js`
  specifiers to `.ts`, which is exactly what this codebase's NodeNext import
  style needs, and it bans non-erasable syntax project-wide. `tsx` is already
  installed for `pnpm dev`, so using it costs nothing.
- **`supertest`.** Convenient chained assertions, but two new dependencies
  (`supertest` + `@types/supertest`) to replace ~20 lines of `listen(0)` +
  `fetch`, and it hides the fact that a real socket is involved.
- **Colocating `*.test.ts` inside `src/`.** Shorter import paths, but then
  either the test files get compiled into `dist/` or `tsconfig.json` needs an
  exclude that also drops them from typechecking. A separate `tests/` tree
  keeps `build` and `typecheck` honest with no exclusions.
