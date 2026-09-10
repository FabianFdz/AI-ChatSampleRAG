# CLAUDE.md - AI Chat RAG Project Guide

## Project Overview
A Proof-of-Concept RAG (Retrieval-Augmented Generation) application where users can upload documents and chat with an AI that understands their content.

## Architecture

### Stack
- **Frontend:** Next.js (React) with TypeScript
- **Backend:** Node.js/Express with TypeScript
- **RAG Engine:** LangChain + LangGraph
- **LLM:** Anthropic Claude API — Haiku tier (cheapest available Claude model), for cost reasons
- **Embeddings:** Voyage AI (Anthropic's recommended embeddings partner — Claude itself has no embeddings endpoint)
- **Storage:** In-memory (PoC - no persistence)
- **API:** REST endpoints

### Project Structure
```
ai-chat-rag/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Server entry point
│   │   ├── routes/           # API endpoints
│   │   ├── services/         # Business logic (RAG, LangChain)
│   │   └── utils/            # Helpers
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── app/                  # Next.js app directory
│   ├── components/           # React components
│   ├── lib/                  # Utilities
│   ├── package.json
│   └── tsconfig.json
└── CLAUDE.md                 # This file
```

## Key Requirements

### Backend Endpoints
- `POST /api/session` - Create a new chat session
- `POST /api/session/:id/documents` - Upload documents (PDF/text)
- `POST /api/session/:id/chat` - Send chat message, get AI response
- `GET /api/session/:id` - Get session info

### Frontend Features
1. **Onboarding Page**
   - Upload up to 3 documents (PDF or paste text)
   - File validation
   - Preview uploaded content

2. **Chat Interface**
   - Display document titles
   - Message history (session-based)
   - Streaming responses (if possible)
   - Clear session

### Document Handling
- Accept PDF files (parse with `pdf-parse` or similar)
- Accept pasted text directly
- Store in memory during session
- Chunk documents for RAG
- Use LangChain text splitters

### RAG Flow
1. User uploads documents → Extract text → Chunk → Embed
2. User sends message → Search relevant chunks → Build context
3. LangGraph orchestrates: Retrieve → Prompt → LLM → Stream response

## Development Guidelines

### Code Style
- TypeScript strict mode
- ESLint + Prettier configured
- Functional components preferred (React)
- Async/await over callbacks

### No Premature Optimization
- Store everything in memory (this is a PoC)
- Single user session at a time
- No database setup

### Decisions Already Made
- ✅ Monorepo structure (backend + frontend)
- ✅ Node.js/TypeScript backend
- ✅ Next.js frontend
- ✅ In-memory storage
- ✅ Session-based chat
- ✅ LangChain + LangGraph for RAG
- ✅ Unit tests required for backend tickets going forward (2026-09-09), superseding the earlier "no tests" PoC note below
- ✅ LLM switched from OpenAI to Anthropic Claude API (2026-09-08); embeddings use Voyage AI since Claude has no embeddings endpoint — supersedes the "OpenAI API" line this file used to have and the OpenAI mentions in E3's scope
- ✅ Use the cheapest available Claude model tier (Haiku) for the LLM, not a mid/top-tier model (2026-09-08) — this is a cost-driven PoC, verify the exact current Haiku model id against Anthropic's docs at implementation time rather than hard-coding one here
- ✅ The Claude model id is configurable via an env var (default: the Haiku model above), not hard-coded (2026-09-08) — follows ADR-3's env-config module pattern

### If New Decisions Needed
- Ask before implementing
- Document the decision in this file
- Keep it simple (PoC mentality)

## Setup Instructions
(To be filled in when implementing each part)

## Testing
- Manual testing via frontend
- Unit tests required for backend tickets (decided 2026-09-09) — cover each ticket's core logic/acceptance criteria; pick a minimal test setup consistent with the backend TypeScript stack (e.g. vitest or Node's built-in test runner) unless a ticket's design already specifies one
- No frontend tests required yet (PoC)

---
Created for Fabián Fdz with help from Juanito 🤖
