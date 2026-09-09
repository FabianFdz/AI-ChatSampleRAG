# Plan — E2: Document Processing Pipeline

## Sprint Breakdown
- Sprint 2: E2-T01, E2-T02, E2-T03, E2-T04

## Tickets

### E2-T01: Plain Text Document Ingestion — Sprint 2
**Description:** As a developer integrating documents into the RAG pipeline, I need pasted text and `.txt` file uploads normalized into a single document shape with metadata, so downstream chunking and retrieval can treat all text sources consistently.
**Acceptance Criteria:**
- Given pasted text or a `.txt` file upload, the service returns a normalized document object containing the full text content and metadata (filename or a "pasted-text" label, source type, upload timestamp).
- Empty or whitespace-only input is rejected with a clear error rather than producing an empty document.
- Plain text input up to 10MB processes successfully.
- Unit tests cover normalized output for pasted text, `.txt` file input, and the empty-input rejection case; runnable via `pnpm test` from the backend package (per CLAUDE.md's testing policy, ADR-7/ADR-8).
**E2E Flows:**
- Developer submits pasted text to the ingestion service → receives a normalized document with metadata and the exact text content preserved.
- Developer submits a `.txt` file upload → receives a normalized document with filename metadata and correct text content.
- Developer submits empty/whitespace-only text → receives a validation error instead of an empty document.

### E2-T02: PDF Text Extraction — Sprint 2
**Description:** As a developer integrating documents into the RAG pipeline, I need PDF uploads parsed into the same normalized document shape (using `pdf-parse` or equivalent), preserving page structure and handling bad files gracefully, so PDFs are usable alongside plain text sources.
**Acceptance Criteria:**
- Valid PDF files up to 10MB parse into a normalized document with the full extracted text, without data loss.
- The normalized document includes per-page text/metadata (page numbers) alongside filename and upload timestamp.
- Corrupted or unparseable PDF files fail with a descriptive error instead of crashing the process.
- A typical document (e.g., ~10 pages) processes in under 2 seconds.
- Unit tests cover successful extraction (including page metadata) and the corrupted-file error path; runnable via `pnpm test`.
**E2E Flows:**
- Developer submits a valid PDF → receives a normalized document with full text and page-number metadata matching the source.
- Developer submits a corrupted/non-PDF file with a `.pdf` extension → receives a clear error result, no crash.
- Developer submits a ~10MB PDF → it processes successfully within the performance target.

### E2-T03: Document Chunking Service — Sprint 2
**Description:** As a developer preparing documents for retrieval, I need normalized documents (from E2-T01/T02) split into overlapping chunks with source attribution, so each chunk can be embedded and traced back to its origin document and location.
**Acceptance Criteria:**
- Given a normalized document, the service returns an ordered list of chunks, each up to 1000 characters, with ~200-character overlap between consecutive chunks.
- Each chunk carries metadata: source filename/label, chunk index, and page number(s) when available from PDF extraction.
- Documents shorter than the chunk size produce exactly one chunk without errors.
- Unit tests cover multi-chunk splitting with overlap, page-number propagation from PDF-derived documents, and the single-chunk short-document case; runnable via `pnpm test`.
**E2E Flows:**
- Developer passes a long plain-text document → receives multiple overlapping chunks, each attributable to the original document.
- Developer passes a multi-page PDF's extracted text → receives chunks that each reference the correct page number(s).
- Developer passes a short document (e.g., 200 characters) → receives exactly one chunk containing the full text.

### E2-T04: Chunk Validation & Quality Checks — Sprint 2
**Description:** As a developer relying on the chunking output, I need chunks validated before they're usable downstream — no empty chunks, no chunks missing required metadata, and a clear success/failure result if processing fails partway — so bad input never silently becomes bad retrieval data.
**Acceptance Criteria:**
- Chunks with no content (empty or whitespace-only) are filtered out before being returned to the caller.
- Chunks missing required source metadata (filename/label, chunk index) are treated as a processing error, not passed through silently.
- If extraction or chunking fails partway through a document, the caller receives a clear failure result rather than a partial, ambiguous success.
- Validation runs automatically as part of the ingestion → chunking pipeline, not as a separate manual step.
- Unit tests cover: an empty chunk being filtered, a chunk with missing metadata being rejected, and a mid-pipeline failure surfacing as a clear error; runnable via `pnpm test`.
**E2E Flows:**
- Developer processes a document that yields a stray empty chunk → that chunk does not appear in the final output.
- Developer processes a corrupted file end-to-end → the pipeline returns a clear failure result, not a corrupted or partial success.
- Developer processes a valid document end-to-end (extract → chunk → validate) → receives clean, validated chunks ready for embedding.

## Out of Scope
- HTTP endpoints for document upload (`POST /api/session/:id/documents`) — belongs to E4 (Backend API Endpoints).
- Embedding generation and vector search — belongs to E3 (RAG Engine).
- Frontend upload UI — belongs to E6 (Document Upload UI).
- File formats beyond PDF and plain text (e.g., Word) — no product requirement yet; revisit if needed.
- Duplicate chunk detection — no product requirement yet; revisit if it becomes a retrieval-quality issue.
- Chunk size/overlap tuning beyond the fixed 1000-char/200-char spec — revisit during E3 if retrieval quality demands it.

## Open Questions
None. The epic's "To settle" items are resolved within the acceptance criteria above (10MB file size cap already fixed; formats limited to PDF/text; chunk size fixed at 1000/200) or explicitly deferred (duplicate detection, further chunk-size tuning) — none block sprint planning.
