# ADR-4: Structured logging with `pino` + `pino-http`

- **Status:** Accepted
- **Date:** 2026-09-08
- **Sprint / Tickets:** Sprint 1 — E1-T03

## Context
E1 leaves "logging strategy (Winston, Pino, or console)?" open. E1-T03
requires errors to be "logged with enough detail to debug", and E1 requires
"no warnings in console output". Debuggable in practice means: which request
did this error belong to, what method/path, what status, how long, and the
stack — correlated, not scattered across unrelated `console.log` lines.

## Decision
Use **`pino`** as the application logger and **`pino-http`** as request
middleware, with **`pino-pretty`** as a devDependency for readable local
output.

- `backend/src/utils/logger.ts` exports a singleton `logger`, level from
  `env.LOG_LEVEL`, pretty transport only when `NODE_ENV === 'development'`.
- `pino-http` assigns a request id (`crypto.randomUUID()`) and exposes a
  child logger as `req.log`, so every log line inside a request carries that
  id automatically.
- `autoLogging` **ignores `GET /health`** — otherwise a polling health check
  buries every other line.
- Sensitive fields (`req.headers.authorization`, `req.headers.cookie`) are
  redacted at the logger level, not at each call site.
- `console.log` is not used in application code. The one permitted exception
  is the startup "listening on port N" line, which is also emitted via the
  logger for consistency.

## Consequences
- The request id is logged *and* returned to the client in error responses
  (see ADR-5), so a user-reported failure maps to an exact log line.
- Redaction is already in place before E2/E3 start moving document text and
  prompts through the server; opting into safety later is much harder.
- Log output is JSON in production, human-readable in development.
- `pino-pretty` must stay a devDependency and must never be loaded in
  production — pretty transport is significantly slower.

## Alternatives rejected
- **`console.*` with a small wrapper.** Zero dependencies and defensible for a
  PoC, but request correlation, level filtering, and redaction would all be
  hand-rolled — more code than the dependency it avoids, and worse.
- **Winston.** Heavier, slower, and its transports/formats configuration is
  more surface than this project needs.
