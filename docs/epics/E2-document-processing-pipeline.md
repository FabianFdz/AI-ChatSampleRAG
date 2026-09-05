# E2: Document Processing Pipeline

## Goal
Extract, parse, and intelligently chunk documents (PDF + text) with metadata preservation for RAG retrieval.

## Scope
Document ingestion and preparation layer:
- PDF text extraction using pdf-parse
- Plain text file support
- Intelligent document chunking (1000-char chunks, 200-char overlap)
- Metadata extraction and tracking (filename, upload time, page numbers)
- Source attribution for each chunk
- Chunk validation and quality checks

## Depends on
E1 (Backend Foundation)

## Priority
must-have

## To settle
- Max file size limits?
- Supported formats beyond PDF and text (Word, etc.)?
- Chunk size optimization based on LLM context window?
- Duplicate chunk detection needed?

---

## Acceptance Criteria
- [ ] PDF files parse correctly without data loss
- [ ] Text split into 1000-char chunks with 200-char overlap
- [ ] Each chunk includes source metadata
- [ ] Successfully processes files up to 10MB
- [ ] Graceful error handling for corrupted files
- [ ] Performance: <2s per typical document

## Notes
Unblocks E3 (RAG Engine). Quality of chunking directly impacts retrieval performance.
