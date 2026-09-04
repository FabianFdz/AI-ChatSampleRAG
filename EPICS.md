# RAG PoC Development Epics

## Overview
Development roadmap for the AI Chat RAG proof-of-concept. Each epic represents a major feature or component to be completed.

---

## Epic 1: Backend Foundation
**Goal:** Set up Express.js server, TypeScript configuration, and project structure.

**Requirements:**
- Initialize Express server on port 3001
- Configure TypeScript with strict mode
- Setup error handling middleware
- Create route structure (routes/, services/, utils/)
- Health check endpoint `GET /health`
- Environment configuration (.env support)

**Acceptance Criteria:**
- Server starts with `pnpm dev`
- TypeScript compiles without errors
- API responds to `/health` with 200 OK

---

## Epic 2: Document Processing Pipeline
**Goal:** Extract and chunk documents (PDF + plain text) using LangChain.

**Requirements:**
- PDF parsing with `pdf-parse`
- Plain text direct support
- LangChain `RecursiveCharacterTextSplitter` integration
- Extract metadata (filename, upload time)
- Store chunks with source tracking

**Acceptance Criteria:**
- PDF files parse correctly
- Text is split into 1000-char chunks with 200-char overlap
- Each chunk includes source metadata

---

## Epic 3: RAG Engine (LangChain + LangGraph)
**Goal:** Build vector store and retrieval system using LangChain.

**Requirements:**
- OpenAI embeddings integration
- In-memory vector store (using `memory` or `lancedb`)
- LangGraph workflow for: Retrieve → Format → Prompt → LLM
- Session-based context management
- Chat history storage (in-memory)

**Acceptance Criteria:**
- Documents can be embedded and retrieved by similarity
- LLM receives relevant context when prompted
- Chat history persists during session

---

## Epic 4: Backend API Endpoints
**Goal:** Implement REST API for session and chat management.

**Required Endpoints:**
- `POST /api/session` - Create session, return sessionId
- `POST /api/session/:id/documents` - Upload document (PDF/text)
- `POST /api/session/:id/chat` - Send message, stream response
- `GET /api/session/:id` - Get session metadata
- `DELETE /api/session/:id` - Clear session

**Acceptance Criteria:**
- All endpoints respond with proper status codes
- Document uploads validated (max 3 files)
- Chat responses include source citations

---

## Epic 5: Frontend Setup
**Goal:** Initialize Next.js project with TypeScript and styling.

**Requirements:**
- Next.js 14 with App Router
- TypeScript configuration
- TailwindCSS setup
- ESLint + Prettier
- Layout and page structure

**Acceptance Criteria:**
- `pnpm dev` starts dev server on :3000
- TypeScript compiles without errors
- Basic layout renders

---

## Epic 6: Document Upload UI
**Goal:** Build onboarding page for document uploads.

**Requirements:**
- File input for PDF upload
- Text area for pasting plain text
- Display uploaded documents (up to 3)
- File validation (type, size)
- Upload button that calls backend
- Loading state

**Acceptance Criteria:**
- Users can upload PDF or paste text
- UI prevents >3 files
- Upload sends to `POST /api/session/:id/documents`
- Feedback on successful/failed upload

---

## Epic 7: Chat Interface
**Goal:** Build chat UI for Q&A with documents.

**Requirements:**
- Message input field
- Message history display (user + AI)
- Send button
- Loading state while waiting for response
- Display source documents for context
- Clear session button

**Acceptance Criteria:**
- Messages display in chronological order
- AI responses show document sources
- Chat feels responsive and real-time

---

## Epic 8: End-to-End Integration & Testing
**Goal:** Connect frontend and backend, test full user flow.

**Requirements:**
- Frontend makes correct API calls
- Session management works (create → upload → chat)
- Error handling and user feedback
- Performance testing (response time)
- Manual E2E testing

**Acceptance Criteria:**
- User can upload docs → ask questions → get answers
- Response time <5 seconds
- No console errors
- PoC is deployable

---

## Development Order
1. Epic 1 (Backend Foundation) - Day 1
2. Epic 2 (Document Processing) - Day 1
3. Epic 3 (RAG Engine) - Day 2
4. Epic 4 (API Endpoints) - Day 2
5. Epic 5 (Frontend Setup) - Day 2
6. Epic 6 (Upload UI) - Day 3
7. Epic 7 (Chat UI) - Day 3
8. Epic 8 (Integration & Testing) - Day 3

---

Created for ai-chat-rag PoC by Juanito 🤖
