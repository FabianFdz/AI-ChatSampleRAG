# ADR-11: One normalized document shape built from page segments; chunk each segment independently

- **Status:** Accepted
- **Date:** 2026-09-08
- **Sprint / Tickets:** Sprint 2 — E2-T01, E2-T02, E2-T03

## Context
E2-T01 (plain text) and E2-T02 (PDF) must produce "a single document shape so
downstream chunking and retrieval treat all text sources consistently", and
E2-T03's chunks must carry "page number(s) when available from PDF extraction".

So page information has to survive a split. The splitter chosen in ADR-9
returns `string[]` — no character offsets, and it trims chunks and drops the
separators it splits on (measured: 4484 characters of chunk content out of a
4500-character input). That rules out the obvious approach of chunking one big
concatenated string and mapping chunk offsets back to page ranges: the chunks
are not reliably substrings at reliable offsets.

## Decision
The normalized document carries **ordered segments**, and chunking runs
**per segment**:

A **document segment** is a page number (1-based, or `null` when the source has
no pages) plus the text belonging to it. A **normalized document** carries an
identity (a random UUID), a title (the filename, or the pasted-text label), a
source type of pasted text / text file / PDF, the ordered list of segments, the
full text as a single string, a page count (`null` for text sources), a
character count, and an ISO-8601 upload timestamp. `design.md` holds the
field-by-field table.

- **PDF** → one segment per page, `pageNumber` = the PDF's own 1-based page
  number, kept even for pages with no extractable text (so
  `segments.length === pageCount` always holds).
- **Plain text / pasted text** → exactly one segment with `pageNumber: null`.
  There is no synthetic "page 1"; absent page information is `null`, and a
  chunk from a text source reports `pageNumber: null`.
- The chunker iterates segments in order, calls `splitText(segment.text)` on
  each, and emits `Chunk`s carrying that segment's `pageNumber` plus a
  **document-wide, contiguous** `index`.
- `text` exists for the AC's "full text content", for E6's upload preview and
  for E4's session responses. It is **never** the chunking input. Chunking
  reads `segments` only.

This is also what LangChain's own PDF loaders do (one `Document` per page, then
split), so E3's `Chunk` → `Document` conversion stays a one-liner.

## Consequences
- **Page attribution is exact and free** — no offset bookkeeping, no
  reconstruction, nothing to drift when the splitter's trimming behaviour
  changes.
- **No overlap across a page boundary.** A sentence broken by a page break
  loses the ADR-9 overlap at that seam. Accepted: a page break is already a
  hard boundary in the source, and cross-page context is what retrieving
  multiple chunks is for.
- **A short tail chunk per page.** Measured on a 10-page fixture: each page
  produced `924, 933, 934, 934, 339` characters — a ~339-character remainder
  per page, i.e. ~1 short chunk in 5. Slide-style or sparse PDFs will produce
  more small chunks than chunking the whole document would. Revisit only if E3
  shows a retrieval-quality problem (the plan already defers chunk tuning).
- `pageNumber: number | null` means every consumer must handle `null`.
  Deliberate: it makes "this chunk has no page" explicit rather than encoding it
  as `0`, `1`, or a missing key, and E3's citations can branch on it.
- `text` duplicates the segment content in memory (worst case ~2×10 MB per
  document, ≤3 documents per session). Acceptable for an in-memory PoC; if it
  ever matters, `text` becomes a derived helper and this ADR gets amended.
- Both `NormalizedDocument` and `Chunk` are plain JSON-serialisable data (no
  classes, no `Buffer`, no `Date`), so E4 can return them from a route without
  a mapping layer.

## Alternatives rejected
- **Chunk the concatenated document text, map offsets → pages.** Preserves
  cross-page overlap and yields uniformly sized chunks. Rejected: chunks are
  trimmed and separators dropped, so `indexOf`-style offset recovery is
  unreliable, and a wrong page number is worse than none.
- **Use `createDocuments(pageTexts, pageMetadatas)`, which returns
  `loc.lines.from/to` per chunk.** Effectively this same per-segment approach
  implemented inside LangChain, with line ranges for free — but `metadata` is
  typed `Record<string, any>` (ADR-9), so the page number would arrive as
  `any`.
- **Insert page markers (`\f`, `--- page 3 ---`) into one big string.** Cheap,
  but the marker text ends up embedded in chunks and then in the LLM prompt,
  and the splitter can cut a marker in half.
- **Drop page information entirely, keep only the full text.** Simplest, and
  the retrieval pipeline would still work — but it fails E2-T02's and E2-T03's
  ACs and removes any chance of citing a page in the chat UI.
- **Two separate document types (`TextDocument` / `PdfDocument`).** More
  precise types (no `null` page numbers on text documents), at the cost of
  every downstream consumer branching on which one it holds — the opposite of
  the "single document shape" the epic asks for.
