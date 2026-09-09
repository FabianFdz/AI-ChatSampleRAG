# Sprint 2 — E2: Document Processing Pipeline

Epic [E2 — Document Processing Pipeline](../epics/E2-document-processing-pipeline.md)
is **done** as of this sprint: plain text and PDF documents can be ingested,
chunked and validated into embeddable `Chunk`s, ready for E3's retrieval layer.

## Shipped tickets

- **E2-T01 — Plain Text Document Ingestion.** `ingestText()` normalizes pasted
  text and `.txt` file uploads (BOM strip, CRLF/CR → LF, trim) into the shared
  `NormalizedDocument` shape; rejects empty/whitespace-only input and anything
  over the 10MB cap. Also defines `document.types.ts` (shapes + the
  `DOCUMENT_PROCESSING` constants) and `documentErrors.ts` (the error
  vocabulary extended by later tickets).
- **E2-T02 — PDF Text Extraction.** `ingestPdf()` extracts text via `pdf-parse`
  v2's `PDFParse` class, one segment per PDF page (page-free pages kept, never
  dropped), producing the same `NormalizedDocument` shape with page-number
  metadata. Corrupted/unparseable files fail with a descriptive
  `PDF_PARSE_FAILED` error instead of crashing.
- **E2-T03 — Document Chunking Service.** `chunkDocument()` splits each
  document segment independently with LangChain's
  `RecursiveCharacterTextSplitter` (1000 chars / 200 overlap), producing a
  document-wide contiguous list of `Chunk`s, each carrying its source
  segment's page number.
- **E2-T04 — Chunk Validation & Quality Checks.** `validateChunks()` rejects
  chunks with invariant-violating metadata, filters empty/whitespace-only
  chunks, and renumbers survivors contiguously. `documentPipeline.service.ts`
  wires ingest → chunk → validate behind two entry points,
  `processPastedText()` and `processFile()` — the only calls E4 should ever
  make — so validation can't be skipped and a mid-pipeline failure always
  surfaces as a clean rejected promise, never a partial result.

E2-T02 and E2-T03 were coded and reviewed in parallel, in separate git
worktrees, once E2-T01 (shared types and error factories) merged — both only
depend on T01, not on each other. A first for this project; E2-T04 depended on
all three and was built sequentially afterward, itself split into two stacked
PRs (`chunkValidation.service.ts`, then `documentPipeline.service.ts`) per
design.md's line-count guidance.

## Notable decisions / ADRs

- [ADR-9](../adr/ADR-9.md) — chunk with LangChain's
  `RecursiveCharacterTextSplitter` (1000/200), `splitText` only; our own typed
  `Chunk` shape rather than LangChain's untyped `Document`. Overlap is an
  upper bound realised at word granularity, not a guarantee — zero overlap at
  a paragraph boundary is correct behavior, not a bug.
- [ADR-10](../adr/ADR-10.md) — `pdf-parse@^2.4.5`'s class API (`PDFParse`,
  `getText()`), not the v1 default-function API found in most tutorials.
  `unpdf` is the documented, verified fallback if the native `@napi-rs/canvas`
  dependency ever blocks an install.
- [ADR-11](../adr/ADR-11.md) — one normalized document shape built from
  ordered page **segments**; chunking runs per segment, never on the
  concatenated full-text string, so page attribution is exact and needs no
  offset bookkeeping. `pageNumber` is `number | null` — never a synthetic
  page 1 for non-paginated sources.

No mid-sprint policy changes this sprint (unlike sprint 1's E1-T04): the
unit-test requirement (ADR-7/ADR-8) was already in effect from sprint 1 and
applied normally to all four tickets.

## Known issues / carry-overs

- **No HTTP surface yet.** Nothing in `src/routes/` or `src/app.ts` changed —
  the pipeline is a framework-free service layer, called directly by tests
  today. E4 wires it to `POST /api/session/:id/documents`, enforces the
  three-documents-per-session rule, and must import
  `DOCUMENT_PROCESSING.maxDocumentBytes` for its upload middleware's own limit
  rather than re-typing 10MB.
- **`pdf-parse` pulls a native binary** (`@napi-rs/canvas`, ~24MB). Not an
  issue on this machine (macOS arm64, verified), but any future CI image or
  container architecture must confirm `pnpm install` still succeeds; ADR-10
  has a verified drop-in fallback (`unpdf`) if it doesn't.
- **`@langchain/core@^1.2.9` is now pinned.** E3 must add
  `@langchain/langgraph` and `@langchain/openai` at versions compatible with
  core 1.x, verified against the registry at that time (ADR-6), and must not
  add the `langchain` meta-package.
- **Chunk size/overlap (1000/200) are fixed constants**, not env-configurable
  — deferred to E3 by the plan. If retrieval quality is poor, the fix is a
  design change to `DOCUMENT_PROCESSING`, not a scattered tweak.
- **No overlap across a PDF page boundary**, and a short tail chunk is
  expected per page (ADR-11). If E3 sees answers cut off exactly at page
  breaks, that's this decision, not a prompt problem.
