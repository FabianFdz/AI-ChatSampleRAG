# ADR-3: Environment config is a single typed, fail-fast module

- **Status:** Accepted
- **Date:** 2026-09-08
- **Sprint / Tickets:** Sprint 1 — E1-T01

## Context
E1 asks "port configuration for development vs. production?" and requires
`PORT` to be configurable from `.env`. Later epics add `ANTHROPIC_API_KEY`,
`VOYAGE_API_KEY`, model names, chunk sizes — all read from the environment.
The failure mode to
avoid is `process.env.PORT` (typed `string | undefined`) being read ad hoc
across the codebase, with `undefined` or `NaN` discovered at request time
rather than at boot.

## Decision
One module, `backend/src/config/env.ts`, is the **only** place in the backend
that reads `process.env`. It:
1. calls `dotenv/config` (dev-only convenience; real environments inject vars),
2. parses and validates each variable with a small hand-written helper,
3. **throws at import time** if a required variable is missing or malformed,
   so the process dies at startup rather than mid-request,
4. exports a frozen, fully-typed `env` object.

There is no `NODE_ENV`-specific config file and no per-environment `.env.*`
cascade. One schema, values differ per environment. `PORT` defaults to `3001`;
`NODE_ENV` defaults to `development`; `LOG_LEVEL` defaults to `info`.

Validation is hand-written (~30 lines), not `zod` or `envalid`. This is a PoC
with three variables; a schema library is not yet earning its dependency.

## Consequences
- A typo like `PORT=abc` fails loudly at boot with a named error, not with a
  server silently listening on a random port.
- `.env` is gitignored; `.env.example` is committed and is the documented
  contract for what must be set.
- Later epics add variables in exactly one place. When `ANTHROPIC_API_KEY`
  and `VOYAGE_API_KEY` arrive in E3 they become *required* variables, and the
  fail-fast behaviour means a missing key breaks at startup instead of on the
  first chat message.
- Revisit `zod` when the variable count passes ~8 or values need coercion
  beyond string/number/enum.

## Alternatives rejected
- **Read `process.env` inline where needed.** No single source of truth, no
  types, failures surface late.
- **`zod` + `envalid` now.** Better error messages, but an extra dependency
  for three variables in a PoC.
