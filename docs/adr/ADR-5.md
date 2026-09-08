# ADR-5: Error contract — `AppError` + a single JSON error envelope

- **Status:** Accepted
- **Date:** 2026-09-08
- **Sprint / Tickets:** Sprint 1 — E1-T03

## Context
E1 leaves "error response format standards?" open. E1-T03 requires a
consistent JSON error shape for every failure, including unknown routes, and
requires that the server never returns a raw stack trace. Express's default
error handler returns an **HTML** page and, outside production, includes the
stack — unacceptable for a JSON API that a Next.js frontend will consume.

## Decision
**Error envelope** — every non-2xx response from the backend has this body,
with no exceptions:

```json
{ "error": { "code": "NOT_FOUND", "message": "Route GET /nope not found", "requestId": "..." } }
```

`error.details` is optional and used only for field-level validation errors
(arrives in E4). The envelope is nested under `error` so success payloads can
never be confused with failures by the client.

**`AppError`** (`backend/src/errors/AppError.ts`) is the only error type
application code throws deliberately. It carries `statusCode`, a stable
machine-readable `code`, an optional `details`, and `isOperational = true`.
Static helpers (`AppError.notFound()`, `.badRequest()`, `.internal()`) keep
call sites to one line.

**Distinction that drives the handler:**
- `AppError` (operational, expected) → its own `statusCode`/`code`/`message`
  are returned to the client verbatim.
- Any other thrown value (a bug: `TypeError`, a library throw) → **always**
  `500` / `INTERNAL_ERROR` / the generic message
  `"An unexpected error occurred"`. The real message and stack go to the log
  only, in every environment including development. Internal messages are
  never echoed to clients, because a bug's message is exactly the kind of
  thing that leaks paths, queries, and keys.

**Codes are `SCREAMING_SNAKE_CASE` strings**, not numbers, and are part of the
API contract the frontend may branch on.

**Body-parser errors count.** A malformed JSON body makes `express.json()`
throw a `SyntaxError` with a `status` property; the handler must normalise it
to `400 / INVALID_JSON` rather than letting a stray HTML response escape.

## Consequences
- The frontend (E6/E7) can write one error-handling path against one shape.
- `requestId` in the response ties a user-visible failure to a log line
  (ADR-4).
- Adding a new failure mode means adding a `code`, not a new response shape.
- The 404 handler and the error handler must be mounted **last**, after all
  routes, and the error handler must keep its 4-argument signature or Express
  will treat it as ordinary middleware.

## Alternatives rejected
- **RFC 7807 `application/problem+json`.** Standard and well-specified, but
  its `type` URI field is ceremony this PoC gains nothing from.
- **Flat `{ error: "message" }`.** No stable code to branch on, no room for
  `details` or `requestId` later without a breaking change.
- **Returning internal messages in development.** Convenient, but it creates
  two response shapes to reason about and encourages leaking them by
  accident when `NODE_ENV` is misconfigured. The log already has the detail.
