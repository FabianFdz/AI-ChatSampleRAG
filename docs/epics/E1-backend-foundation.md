# E1: Backend Foundation

## Goal
Express.js server with TypeScript, structured routing, and error handling ready for RAG features.

## Scope
This epic establishes the foundational backend infrastructure:
- Production-ready Express.js server initialization
- Strict TypeScript type safety across backend
- Standardized error handling and middleware patterns
- Modular route and service structure
- Environment configuration support
- Basic health check and monitoring endpoints

## Depends on
None (foundation epic)

## Priority
must-have

## To settle
- Port configuration for development vs. production?
- Logging strategy (Winston, Pino, or console)?
- Error response format standards?
- Rate limiting requirements?

---

## Acceptance Criteria
- [ ] Express server starts with `pnpm dev` on port 3001
- [ ] TypeScript compiles with strict mode, zero errors
- [ ] `GET /health` returns 200 OK with JSON response
- [ ] Error middleware catches and logs all unhandled errors
- [ ] Environment variables load from .env
- [ ] No warnings in console output

## Notes
First epic to complete. Unblocks all other backend epics (E2, E3, E4).
