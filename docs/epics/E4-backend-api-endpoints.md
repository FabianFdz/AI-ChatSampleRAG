# E4: Backend API Endpoints

## Goal
REST API layer exposing session management, document upload, and chat interactions.

## Scope
HTTP endpoint implementation:
- Session lifecycle management (`POST /api/session`, `GET /api/session/:id`, `DELETE /api/session/:id`)
- Document upload endpoint with validation (`POST /api/session/:id/documents`)
- Chat message endpoint with streaming response (`POST /api/session/:id/chat`)
- Request validation middleware
- Rate limiting and quota enforcement
- Proper HTTP status codes and error responses
- API response standardization

## Depends on
E1 (Backend Foundation), E3 (RAG Engine)

## Priority
must-have

## To settle
- Response streaming vs. buffered responses?
- File upload size limits per session?
- Rate limiting strategy (per session, per IP)?
- Authentication needed for MVP?

---

## Acceptance Criteria
- [ ] All 5 endpoints respond with correct HTTP status codes
- [ ] Document uploads validated (max 3 files, max 10MB each)
- [ ] Chat responses include source citations
- [ ] Consistent JSON response schema
- [ ] Rate limiting returns 429 when exceeded
- [ ] API documentation (OpenAPI/Swagger)

## Notes
Primary interface between frontend and backend. Impacts E6, E7, E8.
