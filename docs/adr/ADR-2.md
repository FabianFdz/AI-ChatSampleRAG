# ADR-2: TypeScript dev runtime is `tsx`; ESM with `module: NodeNext`

- **Status:** Accepted
- **Date:** 2026-09-08
- **Sprint / Tickets:** Sprint 1 — E1-T01

## Context
`backend/package.json` declares `"type": "module"` and a dev script of
`node --loader ts-node/esm src/index.ts`. That script is broken in practice:
`--loader` is deprecated in Node 20+ and emits an `ExperimentalWarning` on
every start, which directly violates the E1 acceptance criterion "no warnings
in console output". ts-node's ESM mode also requires `.js`-suffixed specifiers
*and* extra flags, and has no watch mode of its own.

The backend has no `tsconfig.json` at all yet, so the module system is
genuinely undecided in code.

## Decision
- Dev runtime: **`tsx`** (`tsx watch src/index.ts`). No `--loader`, no
  warnings, built-in watch/restart.
- Keep **ESM** (`"type": "module"`) with `"module": "NodeNext"`,
  `"moduleResolution": "NodeNext"`, `"target": "ES2022"`.
- Production build stays `tsc` → `dist/`, run with plain `node dist/index.js`.
  tsx is a devDependency only; it never runs in production.
- Type checking is a separate, explicit step: `pnpm typecheck` → `tsc --noEmit`.
  tsx strips types without checking them, so this is what actually enforces
  the "compiles in strict mode with zero errors" criterion.

## Consequences
- **All relative imports must carry a `.js` extension** even though the source
  file is `.ts` — `import { env } from './config/env.js'`. This is required by
  `NodeNext` so the emitted `dist/` output is runnable by Node directly. This
  is the single most likely thing to be gotten wrong; it is called out in
  `design.md` as a hard rule.
- ESM matches LangChain/LangGraph's ESM-first packaging (E2/E3) and allows
  top-level `await`.
- `__dirname`/`__filename` are unavailable; use
  `import.meta.url` if a path is ever needed.

## Alternatives rejected
- **Node 24 native type stripping** (`node --watch src/index.ts`). Zero
  dependencies, but requires `.ts` import specifiers plus
  `rewriteRelativeImportExtensions` to still produce a runnable `tsc` build,
  bans `enum`/parameter properties, and silently pins the project to a very
  recent Node. Too much coupling to the local toolchain for a PoC.
- **Drop ESM, use CommonJS.** Simplest resolution story, but fights
  LangChain's ESM-first direction in E2/E3 and contradicts the existing
  `"type": "module"` declaration.
- **`ts-node-dev` / `nodemon` + ts-node.** More configuration, slower, and
  keeps the deprecated-loader warning problem.
