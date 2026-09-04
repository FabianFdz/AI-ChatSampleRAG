# CLAUDE.md - AI Chat RAG Project Guide

## Project Overview
A Proof-of-Concept RAG (Retrieval-Augmented Generation) application where users can upload documents and chat with an AI that understands their content.

## Architecture

### Stack
- **Frontend:** Next.js (React) with TypeScript
- **Backend:** Node.js/Express with TypeScript
- **RAG Engine:** LangChain + LangGraph
- **LLM:** OpenAI API (or configurable)
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

### If New Decisions Needed
- Ask before implementing
- Document the decision in this file
- Keep it simple (PoC mentality)

## Setup Instructions
(To be filled in when implementing each part)

## Testing
- Manual testing via frontend
- No tests required yet (PoC)

---
Created for Fabián Fdz with help from Juanito 🤖
