# Plan — E1: Backend Foundation

## Sprint Breakdown
- Sprint 1: E1-T01, E1-T02, E1-T03

## Tickets

### E1-T01: Express Server Bootstrap — Sprint 1
**Description:** As a developer, I need a TypeScript Express server that starts reliably in development with configurable environment settings, so I have a foundation to build API features on.
**Acceptance Criteria:**
- Running `pnpm dev` from the backend package starts an Express server on port 3001 by default.
- Port is configurable via a `PORT` environment variable loaded from `.env`.
- TypeScript compiles in strict mode with zero errors and zero console warnings on startup.
**E2E Flows:**
- Developer runs `pnpm dev` with no `.env` override → server starts and logs that it is listening on port 3001.
- Developer sets `PORT=4000` in `.env` and runs `pnpm dev` → server starts and listens on port 4000 instead.

### E1-T02: Health Check Endpoint — Sprint 1
**Description:** As an operator/consumer of the API, I need a health check endpoint so I can verify the backend is running and ready to accept requests.
**Acceptance Criteria:**
- `GET /health` returns HTTP 200 with a JSON body indicating service status.
- The endpoint works immediately after the server is up, with no dependency on other features (sessions, documents, etc.).
**E2E Flows:**
- Client sends `GET /health` while the server is running → receives 200 OK with a JSON status payload.
- Client sends `GET /health` immediately after server startup → receives a successful response with no race condition or startup lag.

### E1-T03: Global Error Handling & Modular Route/Service Structure — Sprint 1
**Description:** As a developer extending this backend, I need centralized error handling and a consistent folder structure for routes and services, so future endpoints fail predictably and new features are easy to add without duplicating boilerplate.
**Acceptance Criteria:**
- Any unhandled error thrown in a route handler is caught by centralized error-handling middleware instead of crashing the server.
- Errors are logged with enough detail to debug.
- Clients receive a consistent JSON error response shape (status code + message) for any caught error, including requests to unknown routes (404).
- New routes/services can be added under a clear `routes/` and `services/` structure without modifying core server setup.
**E2E Flows:**
- Client requests a route that intentionally throws an error → server responds with a structured JSON error (not a raw stack trace) and stays running.
- Client requests a nonexistent route (e.g., `GET /does-not-exist`) → server responds with a 404 JSON error instead of crashing or hanging.
- Developer adds a new route file under `routes/` → it is wired into the server without editing the core error-handling logic in `index.ts`.

## Out of Scope
- Actual RAG/document/chat endpoints (E2, E3, E4).
- Authentication or multi-user session isolation.
- Rate limiting (deferred — no product requirement yet; revisit if abuse becomes a concern).
- Persistent storage or database setup (explicitly in-memory per project conventions).
- Frontend work (E5+).

## Open Questions
None. The epic's "To settle" items (port config strategy, logging library, error response format, rate limiting) are implementation decisions for the Architect/Coder to make within the acceptance criteria above — they don't block sprint planning.
