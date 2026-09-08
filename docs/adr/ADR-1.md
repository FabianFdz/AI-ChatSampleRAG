# ADR-1: Use Express 5 instead of Express 4

- **Status:** Accepted
- **Date:** 2026-09-08
- **Sprint / Tickets:** Sprint 1 — E1-T01, E1-T03

## Context
`backend/package.json` currently pins `express@^4.18.2`. E1-T03 requires that
*any* unhandled error in a route handler reach centralized error middleware
instead of crashing the server.

In Express 4, a rejected promise from an `async` route handler is **not**
forwarded to the error middleware. It surfaces as an unhandled rejection and
the request hangs until it times out. The standard workaround is to wrap every
async handler in an `asyncHandler(fn)` utility — a rule that must be
remembered on every route added, forever, and whose omission fails silently.
That is a poor foundation for E2–E4, which are almost entirely async
(PDF parsing, embeddings, LLM calls).

Express 5 (5.2.1 current) forwards rejected promises from handlers and
middleware to the error handler natively.

## Decision
Upgrade the backend to `express@^5.2.1` and `@types/express@^5.0.6`. Do not
introduce an `asyncHandler` wrapper — there is exactly one error propagation
mechanism, and it is the framework's.

## Consequences
- Async handlers can `throw` directly; no wrapper, no per-route discipline.
- Express 5 breaking changes the Coder must respect:
  - **Path matching uses path-to-regexp 8.** `app.all('*', ...)` and
    `app.use('*', ...)` are invalid. The 404 handler must be mounted as
    `app.use(notFoundHandler)` with **no path argument**, last in the chain.
  - `req.query` is a getter and is no longer mutable.
  - `res.status(code).send(body)` no longer accepts a bare number as body.
- Errors thrown *after* response headers are sent are still not recoverable;
  the error handler must delegate to `next(err)` in that case.
- Affects later sprints: E4 route definitions and any streaming chat endpoint
  must be written against Express 5 semantics.

## Alternatives rejected
- **Stay on Express 4 + `asyncHandler` wrapper.** Adds a mandatory, easily
  forgotten wrapper to every future async route; failure mode is a hung
  request rather than a loud error.
- **Fastify.** Better ergonomics for this, but `CLAUDE.md` fixes the stack as
  Express. Not an architect's call to swap unilaterally.
