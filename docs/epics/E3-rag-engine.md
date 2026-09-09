# E3: RAG Engine (LangChain + LangGraph)

## Goal
Semantic search and retrieval-augmented generation system with stateful conversation context.

## Scope
Core RAG intelligence layer:
- Voyage AI embeddings integration for semantic search (Claude has no embeddings endpoint)
- In-memory vector store (LanceDB) for document indexing
- LangGraph workflow orchestration (Retrieve → Format → Prompt → LLM)
- Session-based context management
- Chat history storage and retrieval
- Relevance ranking and filtering of retrieved chunks
- Streaming response support for LLM outputs (Claude API)

## Depends on
E2 (Document Processing Pipeline)

## Priority
must-have

## To settle
- Vector DB: LanceDB vs. alternatives (Pinecone, Weaviate)?
- Voyage embedding model: `voyage-3` vs. `voyage-3-lite` vs. domain-specific variants?
- Context window management for long conversations?
- Multi-turn conversation strategy?

---

## Acceptance Criteria
- [ ] Documents embedded and searchable by semantic similarity
- [ ] Retrieval returns top-3 relevant chunks per query
- [ ] LLM receives formatted context in prompt
- [ ] Chat history persists throughout session
- [ ] Response time <3s for typical retrieval + LLM calls
- [ ] No data loss on session timeout

## Notes
Critical for RAG quality. Impacts all downstream epics (E4, E6, E7, E8).
