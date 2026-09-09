# Sprint 2 Design — tickets E2-T01, E2-T02, E2-T03, E2-T04

## Tickets in Scope
- **E2-T01** — Plain Text Document Ingestion
- **E2-T02** — PDF Text Extraction
- **E2-T03** — Document Chunking Service
- **E2-T04** — Chunk Validation & Quality Checks

Build them **in that order**; each assumes the previous is merged. T01
establishes the shared types and error factories that T02–T04 extend. Nothing
in this sprint touches `src/routes/` or `src/app.ts` — the service layer only
(HTTP wiring is E4).

## ADRs produced
| ADR | Decision |
|---|---|
| [ADR-9](../../../docs/adr/ADR-9.md) | Chunk with LangChain `RecursiveCharacterTextSplitter` (1000/200), `splitText` only |
| [ADR-10](../../../docs/adr/ADR-10.md) | PDF text via `pdf-parse` **v2**'s `PDFParse` class; `unpdf` documented as fallback |
| [ADR-11](../../../docs/adr/ADR-11.md) | One normalized document shape built from page **segments**; chunk each segment independently |

Everything asserted about these libraries below was measured against the real
packages (Node 24, pnpm 11.21, `tsc` 5.9, `@types/node@20`) before the design
was written. Where a number appears, it came from a run, not from docs.

## Rules that apply to all four tickets
1. **Relative imports end in `.js`** — `import { AppError } from '../errors/AppError.js'`
   even though the file is `.ts` (ADR-2). Wrong extensions break `pnpm start`
   while `pnpm dev` keeps working, so the dev server will not catch it.
2. **No `any`**, no `@ts-ignore`, no non-null `!`. `strict` and
   `noUncheckedIndexedAccess` are on — prefer `.map()` / `for…of` over indexing.
3. **Services are framework-free** (sprint-1 flag 7): never import `express`,
   never see `req`/`res`. Importing `utils/logger.js` and `errors/*` is fine.
4. **No `console.*`** — use the logger (ADR-4).
5. **Failure is signalled by throwing an `AppError` with a new `code`**
   (ADR-5, sprint-1 flag 4). No new response shapes, no `Result`/`Either` type
   — see *Why there is no Result type* under E2-T04.
6. **Tests ship in the same PR as the code** (ADR-7), under `backend/tests/`
   mirroring `src/`, on `node:test` + `node:assert/strict` (ADR-8 — `assert.equal`,
   never `expect`; no vitest, no supertest). Rules 1–4 apply to test files too.
7. Add **only** the dependencies listed per ticket, in the ticket that first
   imports them (ADR-6).

## Technical Approach

### Target file layout after this sprint
```
backend/
├── src/
│   ├── services/
│   │   ├── document.types.ts          # T01 — shared types + frozen constants
│   │   ├── textIngestion.service.ts   # T01 — ingestText()
│   │   ├── pdfIngestion.service.ts    # T02 — ingestPdf()
│   │   ├── chunking.service.ts        # T03 — chunkDocument()
│   │   ├── chunkValidation.service.ts # T04 — validateChunks()
│   │   └── documentPipeline.service.ts# T04 — processPastedText(), processFile()
│   └── errors/
│       ├── AppError.ts                # unchanged
│       └── documentErrors.ts          # T01, extended by T02/T04 — error factories
└── tests/
    ├── services/
    │   ├── textIngestion.test.ts       # T01
    │   ├── pdfIngestion.test.ts        # T02
    │   ├── chunking.test.ts            # T03
    │   ├── chunkValidation.test.ts     # T04
    │   └── documentPipeline.test.ts    # T04
    ├── fixtures/
    │   ├── sample-3page.pdf            # T02 (committed, ~4 KB)
    │   └── blank.pdf                   # T02 (committed, ~1 KB)
    └── helpers/documentFixtures.ts     # T03 (optional) — builds NormalizedDocuments
```
`src/services/.gitkeep` is deleted once a real service lands there.
Naming follows sprint 1: `*.service.ts` for services, `camelCase` filenames,
`PascalCase` for classes only. `document.types.ts` is a new convention — one
types module per service family; it may also export frozen constants.

### Shared shapes (E2-T01 defines them; ADR-11 explains why)

`src/services/document.types.ts`:
```ts
export type DocumentSourceType = 'pasted-text' | 'text-file' | 'pdf';

export interface DocumentSegment {
  pageNumber: number | null;   // PDF page (1-based); null for text sources
  text: string;
}

export interface NormalizedDocument {
  id: string;                  // randomUUID()
  title: string;               // filename, or 'pasted-text'
  sourceType: DocumentSourceType;
  segments: DocumentSegment[]; // chunking input — PDF: one per page, in order
  text: string;                // full text; display/preview only, NEVER chunked
  pageCount: number | null;    // PDF page total; null for text sources
  charCount: number;           // text.length
  uploadedAt: string;          // new Date().toISOString()
}

export interface ChunkMetadata {
  source: string;              // = document.title
  sourceType: DocumentSourceType;
  pageNumber: number | null;
  uploadedAt: string;
}

export interface Chunk {
  id: string;                  // `${documentId}#${index}`
  documentId: string;
  index: number;               // 0-based, document-wide, contiguous
  text: string;
  metadata: ChunkMetadata;
}

export interface ProcessedDocument {   // T04's pipeline return value
  document: NormalizedDocument;
  chunks: Chunk[];
}

export const DOCUMENT_PROCESSING = Object.freeze({
  maxDocumentBytes: 10 * 1024 * 1024,  // 10MB (plan AC)
  chunkSize: 1000,
  chunkOverlap: 200,
  pastedTextTitle: 'pasted-text',
});
```
All of it is plain JSON-serialisable data — no classes, no `Buffer`, no `Date`
— so E4 can return it from a route unmapped. These are **not** env-configurable
(plan defers tuning).

### Error vocabulary added this sprint

`src/errors/documentErrors.ts` — one exported factory per code, each returning
`new AppError(...)`. Keeping them in one module is what stops the code
vocabulary from drifting across four services.

| Factory | Status | `code` | User-facing message |
|---|---|---|---|
| `emptyDocumentError(reason?)` | 400 | `EMPTY_DOCUMENT` | `Document contains no readable text.` (PDF path appends `It may be a scanned image.`) |
| `documentTooLargeError(bytes)` | 413 | `DOCUMENT_TOO_LARGE` | `Document is larger than the 10MB limit.` + `details: { bytes, maxBytes }` |
| `unsupportedFileTypeError(filename)` | 415 | `UNSUPPORTED_FILE_TYPE` | `Only PDF and plain text files are supported.` + `details: { filename }` |
| `pdfParseError(cause: unknown)` | 400 | `PDF_PARSE_FAILED` | `Could not read this PDF file. It may be corrupted or password-protected.` + `details: { reason: <error name> }` |
| `chunkValidationError(problem: string)` | 500 | `CHUNK_VALIDATION_FAILED` | `Document processing produced invalid chunks.` + `details: { problem }` |
| `documentProcessingError(cause: unknown)` | 500 | `DOCUMENT_PROCESSING_FAILED` | `Document processing failed.` (generic wrapper for non-`AppError` throws) |

Underlying library messages and stacks are **logged, never returned** (ADR-5);
only the `error.name`-style `reason` crosses the boundary. `errorHandler`
already maps any `AppError.statusCode` — 413/415 need no middleware change.

---

### E2-T01 — Plain Text Document Ingestion

**New dependencies: none.** Pure TypeScript.

**`src/services/textIngestion.service.ts`**
```ts
export interface TextIngestionInput {
  content: string | Uint8Array;   // Uint8Array = an uploaded .txt buffer
  filename?: string;              // absent => pasted text
}
export function ingestText(input: TextIngestionInput): NormalizedDocument
```
Synchronous — there is no I/O. Steps, in this order:

1. **Size check first, on bytes, before decoding.** `Uint8Array` →
   `content.byteLength`; `string` → `Buffer.byteLength(content, 'utf8')`.
   Over `maxDocumentBytes` → throw `documentTooLargeError(bytes)`. Checking
   before normalisation avoids building a second 10 MB string for a document
   we are about to reject.
2. **Decode** `Uint8Array` with `new TextDecoder('utf-8')` (non-fatal:
   undecodable bytes become U+FFFD rather than an exception — a PoC accepts
   slightly mangled text over refusing the upload).
3. **Normalise** (this is the whole "normalized" in the ticket title):
   strip a leading BOM (`﻿`), `\r\n` → `\n`, bare `\r` → `\n`, then
   `.trim()` the result. Nothing else — no whitespace collapsing, no case or
   punctuation changes. CRLF normalisation is load-bearing: it makes the
   ADR-9 splitter's `\n\n` separator behave identically for Windows-authored
   `.txt` files.
4. **Emptiness check on the normalised text** — `=== ''` → throw
   `emptyDocumentError()`. This is what makes whitespace-only input fail
   instead of producing an empty document.
5. **Build** the `NormalizedDocument`: `id: randomUUID()` (`node:crypto`),
   `title: input.filename ?? DOCUMENT_PROCESSING.pastedTextTitle`,
   `sourceType: input.filename ? 'text-file' : 'pasted-text'`,
   `segments: [{ pageNumber: null, text }]`, `text`, `pageCount: null`,
   `charCount: text.length`, `uploadedAt: new Date().toISOString()`.

Export the normalise step as `normalizeText(raw: string): string` from this
module — T02 reuses it per page, and it is worth testing on its own.

**Unit tests — `tests/services/textIngestion.test.ts`** must assert:
- Pasted string → `sourceType 'pasted-text'`, `title 'pasted-text'`,
  `pageCount === null`, `segments.length === 1`,
  `segments[0].pageNumber === null`, `segments[0].text === doc.text`,
  `charCount === doc.text.length`, and the text is preserved exactly
  (input already trimmed and LF-only ⇒ `doc.text === input`).
- `filename: 'notes.txt'` with a `Uint8Array` body (use
  `new TextEncoder().encode(...)`) → `sourceType 'text-file'`,
  `title 'notes.txt'`, decoded text correct.
- `uploadedAt` round-trips: `new Date(doc.uploadedAt).toISOString() === doc.uploadedAt`.
- `id` is a non-empty string and two calls produce different `id`s.
- Empty-input rejection, one assertion per case: `''`, `'   '`,
  `'\n\n\t  \r\n'`, and an empty `Uint8Array` — each
  `assert.throws(..., (e) => e instanceof AppError && e.code === 'EMPTY_DOCUMENT')`.
- Normalisation: `'a\r\nb\rc'` → `'a\nb\nc'`; a leading `﻿` is gone;
  leading/trailing blank lines are trimmed while **interior** `\n\n` survives.
- Size: `maxDocumentBytes + 1` bytes → throws with `code
  'DOCUMENT_TOO_LARGE'`; a multi-byte string (e.g. `'é'.repeat(...)`) is judged
  by **bytes, not characters** — this is the assertion that catches a
  `.length` implementation.
- Exactly `maxDocumentBytes` succeeds (one 10 MB happy-path case; it runs in
  milliseconds because ingestion does no chunking).

**Verify:** `pnpm --filter backend test`, `pnpm --filter backend typecheck`,
`pnpm --filter backend build && pnpm --filter backend start` (still boots — this
is what catches a missing `.js` import extension).

Estimated diff: ~230 lines (~110 src across three files, ~120 tests). If it
runs past 250, split as T01a (`document.types.ts` + `documentErrors.ts` +
`normalizeText` + its tests) and T01b (`ingestText` + its tests).

---

### E2-T02 — PDF Text Extraction

**New dependency: `pdf-parse@^2.4.5`** (ADR-10 — v2's class API; anything that
looks like `pdfParse(buffer)` is v1 and is wrong).

**`src/services/pdfIngestion.service.ts`**
```ts
export interface PdfIngestionInput { content: Uint8Array; filename: string }
export async function ingestPdf(input: PdfIngestionInput): Promise<NormalizedDocument>
```
1. Size check on `content.byteLength` → `documentTooLargeError`.
2. `const parser = new PDFParse({ data: new Uint8Array(content) })`, then
   `await parser.getText()` inside `try`, with **`await parser.destroy()` in
   `finally`** — on the success *and* failure paths. A leaked pdf.js worker
   turns `pnpm test` into a hang instead of a failure.
3. `catch (cause)`: log the real error via `logger`
   (`logger.warn({ err: cause, filename }, 'pdf parse failed')`), then
   `throw pdfParseError(cause)`. Nothing pdfjs-shaped escapes this module.
4. Map the result (`TextResult { total, text, pages: [{ num, text }] }`):
   `segments = result.pages.map((p) => ({ pageNumber: p.num, text: normalizeText(p.text) }))`
   — every page kept, including text-free ones, so
   `segments.length === pageCount` holds. `pageCount = result.total`.
5. `text = segments.map((s) => s.text).join('\n\n')` — build it ourselves
   rather than using `result.text`, so the page separator is exactly the
   splitter's paragraph separator. Then `text.trim() === ''` → throw
   `emptyDocumentError('It may be a scanned image.')` (an image-only PDF is
   the realistic case).
6. `sourceType: 'pdf'`, `title: input.filename`, rest as in T01.

**Test fixtures** — generate once outside the repo and commit the two PDFs; do
**not** add a PDF-authoring dependency to `package.json`:
```sh
mkdir -p /tmp/fx && cd /tmp/fx && npm init -y >/dev/null && npm i pdf-lib
# script: 3 pages; page N starts with the line `PAGE-N-MARKER` and carries
# >=1400 chars of text unique to that page (so each page yields >=2 chunks);
# plus a 1-page document with no drawn text at all.
# then: cp sample-3page.pdf blank.pdf <repo>/backend/tests/fixtures/
```
Load them in tests with `readFile(new URL('../fixtures/sample-3page.pdf', import.meta.url))`
— never `__dirname` (ESM) and never a cwd-relative path.
The corrupt-file cases need no fixture: `new TextEncoder().encode('%PDF-1.4 not a real pdf')`
and `new TextEncoder().encode('just plain text')` both produce pdfjs's
`InvalidPDFException` (verified).

**Unit tests — `tests/services/pdfIngestion.test.ts`** must assert:
- `sample-3page.pdf` → `pageCount === 3`, `segments.length === 3`,
  `segments.map(s => s.pageNumber)` deep-equals `[1, 2, 3]`, and
  `segments[i].text` contains `PAGE-${i+1}-MARKER` **and not** the other pages'
  markers. That last part is the real "page metadata is correct" assertion —
  a page-count check alone passes even if the text is misattributed.
- No data loss: `doc.text` contains all three markers, and
  `doc.charCount === doc.text.length`.
- `sourceType 'pdf'`, `title` is the passed filename, `uploadedAt` round-trips.
- Corrupt input and a non-PDF body → `assert.rejects` with `code
  'PDF_PARSE_FAILED'`, `statusCode 400`, and the raw response-safe message
  (assert the message does **not** contain `'InvalidPDF'`; the library detail
  belongs in `details.reason`).
- `blank.pdf` → rejects with `code 'EMPTY_DOCUMENT'`.
- Over-size buffer → `code 'DOCUMENT_TOO_LARGE'`, and it rejects **without**
  invoking the parser (a 10 MB+ `Uint8Array` of zeros is not a PDF; if the
  size check ran second the error code would be `PDF_PARSE_FAILED` — so this
  test also pins the ordering).
- Performance guard: extracting `sample-3page.pdf` completes in under 2000 ms
  (measured ~213 ms cold, ~13 ms warm for 10 pages). A deliberately loose
  smoke guard, not a benchmark.
- The test file must leave no open handle — `pnpm test` exiting on its own is
  part of the acceptance here.

**Verify:** `pnpm --filter backend test` (and confirm the process exits, ~1 s);
`typecheck`; `build` + `start`; manually run a real ~10-page PDF and a real
~10 MB PDF through `ingestPdf` once (the epic's `<2s` / 10 MB criteria) — a
committed 10 MB fixture is not acceptable.

Estimated diff: ~170 lines (~70 src, ~100 tests) + 2 binary fixtures.

---

### E2-T03 — Document Chunking Service

**New dependencies: `@langchain/textsplitters@^1.0.1` and
`@langchain/core@^1.2.9`** (ADR-9 — `core` is a runtime peer, list it
explicitly; do **not** add the `langchain` meta-package).

**`src/services/chunking.service.ts`**
```ts
export async function chunkDocument(document: NormalizedDocument): Promise<Chunk[]>
```
- Construct one `new RecursiveCharacterTextSplitter({ chunkSize:
  DOCUMENT_PROCESSING.chunkSize, chunkOverlap: DOCUMENT_PROCESSING.chunkOverlap })`
  per call (cheap, stateless, keeps the function pure). Default separators —
  do not override them.
- Iterate `document.segments` **in order**; for each, `await
  splitter.splitText(segment.text)`; for each returned string, push a `Chunk`
  with a running document-wide counter as `index`, `id:
  \`${document.id}#${index}\``, `documentId: document.id`, and `metadata:
  { source: document.title, sourceType: document.sourceType, pageNumber:
  segment.pageNumber, uploadedAt: document.uploadedAt }`.
- Chunk `metadata.pageNumber` comes from the **segment**, never from parsing
  the chunk text (ADR-11).
- `splitText('')` returns `[]` (verified), so a text-free PDF page contributes
  no chunks and needs no special case.
- Use `splitText` only — not `createDocuments`, not `splitDocuments`, and do
  not import `Document` (ADR-9: its `metadata` is `any`).
- `logger.debug({ documentId, chunks: chunks.length }, 'document chunked')` at
  the end. No other logging.

**Overlap is an upper bound, not a guarantee — read this before writing the
tests.** Measured with `1000/200`:
- One long paragraph of unique words, no blank lines → sizes
  `995,995,995,995,995,809`, overlap **197** between every consecutive pair.
- Eight paragraphs joined by `\n\n` → four 840-char chunks, overlap **0**,
  because the merge unit is a whole paragraph longer than the overlap budget.

So: **assert overlap only on a fixture with no blank lines.** Asserting ~200
overlap on a multi-paragraph fixture will fail against correct code. ADR-9 has
the full explanation; the Reviewer should read it before judging this ticket
against the plan's "~200-character overlap" wording.

**Unit tests — `tests/services/chunking.test.ts`** must assert:
- **Multi-chunk with overlap:** a ~4800-char single-paragraph document of
  *unique* tokens (e.g. `w0000 w0001 …` — repeated filler makes any
  overlap measurement meaningless, since a periodic string self-matches).
  Assert: more than one chunk; every `text.length <= 1000`; for each
  consecutive pair, the tail of `chunks[i]` equals the head of `chunks[i+1]`
  for some length `n` with `0 < n <= 200`; and no token from the input is
  missing across the concatenated chunks.
- **Ordering/attribution:** `chunks.map(c => c.index)` deep-equals
  `[0..n-1]`; every `documentId === document.id`; every `id === \`${documentId}#${index}\``;
  `metadata.source === document.title`; `metadata.uploadedAt === document.uploadedAt`.
- **Page propagation:** build a `NormalizedDocument` **by hand** with three
  segments (`pageNumber` 1/2/3, each >1400 chars of page-unique text) — no PDF
  needed here, T02 already covers extraction. Assert every chunk containing
  page 2's marker has `metadata.pageNumber === 2`; that the set of page numbers
  seen is `[1,2,3]`; that chunk indices are still globally contiguous and in
  page order; and that **no chunk's text spans two pages** (it must not contain
  markers from two different pages) — the ADR-11 invariant.
- **Text-source documents carry no page number:** every chunk from an
  `ingestText` document has `metadata.pageNumber === null`.
- **Short document:** ~200 chars → exactly one chunk whose `text` equals the
  document's text, `index === 0`.
- **A segment with empty text contributes zero chunks**, and the following
  segment's chunks continue the index sequence without a gap.
- Optional: a helper `tests/helpers/documentFixtures.ts`
  (`makeDocument({ segments, sourceType })`) if the fixture building repeats;
  T04's tests can reuse it.

**Verify:** `pnpm --filter backend test`; `typecheck`; `build` + `start`;
`pnpm --filter backend why @langchain/core` shows it as a direct dependency,
not a hoisted peer.

Estimated diff: ~180 lines (~60 src, ~120 tests).

---

### E2-T04 — Chunk Validation & Quality Checks

**New dependencies: none.**

**`src/services/chunkValidation.service.ts`**
```ts
export function validateChunks(documentId: string, chunks: Chunk[]): Chunk[]
```
Runs in this order:
1. **Reject on invariant violation** (throw
   `chunkValidationError(problem)`, 500 — our own chunker produced these, so a
   violation is a bug, not user input). A chunk is invalid when any of:
   `metadata.source` is not a non-empty string; `documentId` is not a non-empty
   string or does not match the passed `documentId`; `index` is not a
   non-negative integer; `metadata` is absent. The `problem` string names the
   offending field and the chunk `index` — it lands in `details`, and is logged.
2. **Filter out** chunks whose `text.trim() === ''`. If any were dropped,
   `logger.warn({ documentId, dropped }, 'dropped empty chunks')`.
3. **Renumber** the survivors so `index` is contiguous from 0 and
   `id` is rebuilt as `` `${documentId}#${index}` ``. Return new objects
   (spread), never mutate the input. This makes `chunks[i].index === i` a
   guaranteed post-condition for everything downstream — document it in a
   doc comment above the function, since "validate" alone does not imply it.
4. If **zero** chunks survive → throw `emptyDocumentError()`. A document that
   produces no usable chunks is not a success.

The empty-chunk filter is deliberately defensive: the ADR-9 splitter never
emits an empty string (verified — `splitText('')` returns `[]`), so **this
branch cannot be reached end-to-end**. Test it by calling `validateChunks`
directly with a hand-built list. Do not contort the pipeline to produce one.

**`src/services/documentPipeline.service.ts`** — the single entry point E4 will
call, and the thing that makes validation automatic rather than a step a caller
can forget:
```ts
export async function processPastedText(text: string): Promise<ProcessedDocument>
export async function processFile(file: {
  filename: string;
  content: Uint8Array;
  mimeType?: string;
}): Promise<ProcessedDocument>
```
- `processPastedText` → `ingestText({ content: text })` → chunk → validate.
- `processFile` routes by **lower-cased filename extension first**, falling back
  to `mimeType` (multer's mime types are unreliable):
  `.pdf` / `application/pdf` → `ingestPdf`; `.txt` / `.md` / `text/*` →
  `ingestText({ content, filename })`; anything else →
  `unsupportedFileTypeError(filename)`. Routing lives here, not in E4's route,
  so it is unit-testable without HTTP.
- Both wrap the whole sequence: `AppError`s propagate **unchanged** (they
  already carry the right code and status); any other throw is logged and
  re-thrown as `documentProcessingError(cause)`.
- **No partial results, ever.** `ProcessedDocument` is constructed and returned
  only after validation passes, so a mid-pipeline failure can only surface as a
  rejected promise — there is no intermediate state for a caller to
  misinterpret. Nothing is stored here; E4 stores the result in the session
  only on success.
- `logger.info({ documentId, sourceType, chunks }, 'document processed')` on
  success.

**Why there is no `Result`/`Either` type.** The plan's wording ("the caller
receives a clear failure result") is satisfied by a rejected promise carrying an
`AppError`: ADR-5 already routes any `AppError` to one JSON envelope with the
right status code, and sprint 1 fixed "services signal failure by throwing
`AppError`" as the layering rule. Introducing a `Result<T, E>` here would create
a second, parallel error channel that E4's routes would have to unwrap and
re-throw into the first one — more code, two ways to fail, and no reviewer
benefit. This is an application of ADR-5, not a new decision, so it gets no ADR
of its own.

**Unit tests — `tests/services/chunkValidation.test.ts`:**
- Empty and whitespace-only chunks are dropped: a hand-built list of 4 chunks
  where index 1 has `text: ''` and index 2 has `text: '   \n '` → 2 chunks
  returned, both with non-empty text, `indices deep-equal [0, 1]`, `id`s
  rebuilt to match, and the surviving chunks' `text` unchanged.
- The input array is not mutated (assert the original still has 4 entries and
  its original `index` values).
- Missing/invalid metadata → throws, one case each: `metadata.source: ''`,
  `documentId: ''`, a `documentId` that disagrees with the argument,
  `index: -1`, `index: 1.5`. Each asserts `code === 'CHUNK_VALIDATION_FAILED'`,
  `statusCode === 500`, and that `details.problem` names the field.
- A valid list passes through unchanged (deep-equal), so validation is not
  silently rewriting good data.
- All-empty input list, and an input where every chunk is filtered → throws
  `EMPTY_DOCUMENT`.

**Unit tests — `tests/services/documentPipeline.test.ts`** (the end-to-end
flows, still no HTTP):
- Valid pasted text (~4800 chars) → resolves; `document.sourceType
  'pasted-text'`; chunks are contiguous from 0, none empty, every
  `metadata.pageNumber === null`, every `text.length <= 1000`.
- `processFile` with `sample-3page.pdf` → chunks spanning page numbers
  `[1,2,3]`, contiguous indices, `document.pageCount === 3` — the "extract →
  chunk → validate" happy path.
- `processFile` with a `.txt` filename and a `Uint8Array` body → text path,
  `sourceType 'text-file'`.
- `processFile` with a corrupt `.pdf` body → rejects with `PDF_PARSE_FAILED`,
  and the rejection is an `AppError` (not a raw pdfjs error): this is the
  "mid-pipeline failure surfaces as a clear error, not a partial success"
  assertion. Also assert nothing resolvable is returned (use `assert.rejects`,
  and do not assert on internal state — there is none).
- `processFile` with `report.docx` / `image.png` → rejects with
  `UNSUPPORTED_FILE_TYPE` (415) *before* any parsing is attempted.
- `processPastedText('   ')` → rejects with `EMPTY_DOCUMENT`.
- Extension routing beats a wrong `mimeType`: `{ filename: 'notes.txt',
  mimeType: 'application/pdf' }` takes the text path.
- Optionally: a `mimeType`-only route decision when the filename has no
  extension.

**Deliberately not validated** (say no to these in review): a maximum
chunk-length check (the splitter is measured to respect `chunkSize`, and a hard
throw there would be a new failure mode for no observed problem), duplicate
chunk detection (plan: out of scope), and language/encoding detection.

**Verify:** `pnpm --filter backend test`; `typecheck`; `build` + `start`;
temporarily make `chunkDocument` emit one `text: ''` chunk and confirm the
pipeline still returns clean chunks, then revert.

Estimated diff: ~250 lines (~110 src, ~140 tests). If it runs past 250, split
as T04a (`chunkValidation.service.ts` + its tests) and T04b
(`documentPipeline.service.ts` + its tests) — a clean seam, since the pipeline
imports the validator.

## Data / Schema Changes
**None** — no database, no persistence, no in-memory store yet (`CLAUDE.md`:
in-memory PoC; the session store arrives in E4). This sprint adds *type* shapes
only, listed under *Shared shapes* above; nothing is written anywhere. The
`NormalizedDocument` / `Chunk` interfaces are the de-facto schema E3's vector
store and E4's session store will both hold, which is why they are defined once
in `document.types.ts` and kept JSON-serialisable.

## API / Interface Changes
**No HTTP surface changes.** No route is added, removed, or altered this sprint;
`src/app.ts`, `src/routes/*` and the middleware stack are untouched. `GET
/health` and the ADR-5 error envelope are exactly as sprint 1 left them.

**New internal interfaces (what E3 and E4 build on):**

| Export | Module | Signature |
|---|---|---|
| `ingestText` | `services/textIngestion.service.ts` | `(input: TextIngestionInput) => NormalizedDocument` |
| `normalizeText` | `services/textIngestion.service.ts` | `(raw: string) => string` |
| `ingestPdf` | `services/pdfIngestion.service.ts` | `(input: PdfIngestionInput) => Promise<NormalizedDocument>` |
| `chunkDocument` | `services/chunking.service.ts` | `(document: NormalizedDocument) => Promise<Chunk[]>` |
| `validateChunks` | `services/chunkValidation.service.ts` | `(documentId: string, chunks: Chunk[]) => Chunk[]` |
| `processPastedText` | `services/documentPipeline.service.ts` | `(text: string) => Promise<ProcessedDocument>` |
| `processFile` | `services/documentPipeline.service.ts` | `(file: { filename: string; content: Uint8Array; mimeType?: string }) => Promise<ProcessedDocument>` |
| types + `DOCUMENT_PROCESSING` | `services/document.types.ts` | see *Shared shapes* |
| error factories | `errors/documentErrors.ts` | see *Error vocabulary* |

**New `AppError` codes** (extending sprint 1's `NOT_FOUND`, `INVALID_JSON`,
`INTERNAL_ERROR`): `EMPTY_DOCUMENT` (400), `DOCUMENT_TOO_LARGE` (413),
`UNSUPPORTED_FILE_TYPE` (415), `PDF_PARSE_FAILED` (400),
`CHUNK_VALIDATION_FAILED` (500), `DOCUMENT_PROCESSING_FAILED` (500). E4's
upload route needs no error handling of its own — these already render as the
standard envelope.

## Cross-sprint flags
Decisions here that constrain later sprints — read before starting E3/E4.

1. **`processPastedText` / `processFile` are the only entry points E4 should
   call.** Do not call `ingestPdf` → `chunkDocument` by hand from a route:
   validation is wired into the pipeline (T04's AC), and bypassing it bypasses
   the AC. E4's route parses multipart, enforces the ≤3-documents-per-session
   rule, and hands `{ filename, content, mimeType }` over.
2. **The 10MB cap is enforced in the service** (`DOCUMENT_PROCESSING.maxDocumentBytes`).
   E4 must also configure its upload middleware's own limit to the same
   constant — importing it, not re-typing `10 * 1024 * 1024` — so a huge upload
   is rejected before it is fully buffered in memory.
3. **`pageNumber` is `number | null`.** E3's retrieval/citations and E6's UI
   must handle `null` (pasted text has no pages). Do not paper over it with
   `?? 1`.
4. **`Chunk` is our type, not LangChain's `Document`** (ADR-9). E3 converts at
   the embedding boundary: `new Document({ pageContent: chunk.text, metadata:
   { ...chunk.metadata, chunkId: chunk.id, documentId: chunk.documentId } })`.
   Keep the conversion in one place so the untyped-`metadata` surface stays
   contained.
5. **`@langchain/core@^1.2.9` is now pinned by this sprint.** E3 must add
   `@langchain/langgraph` and `@langchain/openai` versions compatible with
   core 1.x (and must not add the `langchain` meta-package). Verify against the
   registry at that time, per ADR-6.
6. **Chunk size/overlap are fixed constants and the overlap is an upper bound**
   (ADR-9). If E3's retrieval quality is poor, the tuning knobs are
   `DOCUMENT_PROCESSING.chunkSize` / `chunkOverlap` and possibly a token-based
   splitter (`js-tiktoken` is already present via `core`) — one place, and it
   needs an ADR amendment, not a scattered change.
7. **No overlap across page boundaries** (ADR-11), and expect a short tail chunk
   per PDF page. If E3 sees answers cut off exactly at page breaks, that is this
   decision, and the fix is a design change, not a prompt tweak.
8. **`pdf-parse` pulls a native binary** (`@napi-rs/canvas`). E8/CI on a
   different architecture, or any Docker image, must confirm `pnpm install`
   succeeds; ADR-10 records `unpdf` as the verified swap-in if it does not.
9. **`document.text` is display-only.** E6's preview and E4's responses may read
   it; nothing may chunk or embed it — chunking reads `segments` (ADR-11). A 10
   MB document is held twice in memory; if the session store makes that hurt,
   `text` becomes a derived helper.
10. **Every service here is synchronous-or-`Promise` and framework-free**, with
    no import-time side effects and no injected collaborators needed — so
    sprint 1's flag 11 (testability) is satisfied without seams. E3's LLM client
    is the case that will need injection (ADR-8); do not break this property by
    reaching for a module-level singleton there.
