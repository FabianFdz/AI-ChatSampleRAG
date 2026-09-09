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

**This document describes *what* to build and *why*. It deliberately contains
no implementation code — the Coder owns every line of that.** Field names,
type names, function names, exported symbols, error codes and library API names
are prescriptive; how they are expressed in TypeScript is the Coder's call,
within the rules below.

## Rules that apply to all four tickets
1. **Relative imports end in `.js`** even though the files are `.ts` (ADR-2) —
   e.g. an import of `AppError` resolves to `../errors/AppError.js`. Wrong
   extensions break `pnpm start` while `pnpm dev` keeps working, so the dev
   server will not catch it.
2. **No `any`**, no `@ts-ignore`, no non-null `!`. `strict` and
   `noUncheckedIndexedAccess` are on — prefer mapping and iteration over
   indexing into arrays.
3. **Services are framework-free** (sprint-1 flag 7): never import `express`,
   never see `req`/`res`. Importing the shared logger and the error modules is
   fine.
4. **No `console.*`** — use the logger (ADR-4).
5. **Failure is signalled by throwing an `AppError` with a new `code`**
   (ADR-5, sprint-1 flag 4). No new response shapes, no `Result`/`Either` type
   — see *Why there is no Result type* under E2-T04.
6. **Tests ship in the same PR as the code** (ADR-7), under `backend/tests/`
   mirroring `src/`, on Node's built-in test runner with `node:assert/strict`
   (ADR-8 — the `assert.equal` family, never `expect`; no vitest, no
   supertest). Rules 1–4 apply to test files too.
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

All of these live in `src/services/document.types.ts`. Everything is plain,
JSON-serialisable data — no classes, no `Buffer`, no `Date` instances — so E4
can return it from a route without a mapping layer. None of it is
env-configurable (the plan defers tuning).

**`DocumentSourceType`** — a union of three string literals:
`'pasted-text'`, `'text-file'`, `'pdf'`.

**`DocumentSegment`** — one unit of source text that shares a single page
attribution. This is the unit the chunker splits.

| Field | Type | Purpose |
|---|---|---|
| `pageNumber` | number (1-based) or `null` | The PDF page this text came from; `null` for text sources, which have no pages. Never a synthetic `1`. |
| `text` | string | The segment's normalised text. May be empty (a PDF page with no extractable text). |

**`NormalizedDocument`** — the single shape both E2-T01 and E2-T02 produce.

| Field | Type | Purpose |
|---|---|---|
| `id` | string, non-empty (a random UUID) | Identity for the document; every chunk references it. |
| `title` | string, non-empty | The uploaded filename, or the literal pasted-text label for pasted input. Surfaces in chunk metadata and in the UI. |
| `sourceType` | `DocumentSourceType` | Which ingestion path produced this. |
| `segments` | array of `DocumentSegment`, ordered, at least one | **The chunking input.** PDF: exactly one entry per page, in page order. Text: exactly one entry. |
| `text` | string, non-empty | The full text. For **display/preview and API responses only — never chunked** (ADR-11). |
| `pageCount` | number or `null` | The PDF's page total; `null` for text sources. When non-null it always equals `segments.length`. |
| `charCount` | number | Length of `text`, so callers need not recompute it. |
| `uploadedAt` | string (ISO-8601, UTC) | Upload timestamp; copied into every chunk's metadata. |

**`ChunkMetadata`** — the source attribution carried by every chunk.

| Field | Type | Purpose |
|---|---|---|
| `source` | string, non-empty | The document's `title` — filename or pasted-text label. |
| `sourceType` | `DocumentSourceType` | Copied from the document. |
| `pageNumber` | number or `null` | Copied from the **segment** the chunk came from, never inferred from the chunk text. |
| `uploadedAt` | string (ISO-8601) | Copied from the document. |

**`Chunk`** — one embeddable unit.

| Field | Type | Purpose |
|---|---|---|
| `id` | string, non-empty | Stable chunk identity, derived from the document id and the chunk index joined by a `#` (e.g. `<uuid>#3`). |
| `documentId` | string, non-empty | The owning document's `id`. |
| `index` | integer ≥ 0 | Position within the document, **document-wide and contiguous** — after validation, a chunk's `index` always equals its position in the returned array. |
| `text` | string, non-empty after validation | The chunk content, never longer than the configured chunk size. |
| `metadata` | `ChunkMetadata` | Source attribution (above). |

**`ProcessedDocument`** — E2-T04's pipeline return value: two fields,
`document` (a `NormalizedDocument`) and `chunks` (an array of validated
`Chunk`s).

**`DOCUMENT_PROCESSING`** — one frozen constants object, the single place these
numbers exist:

| Key | Value | Meaning |
|---|---|---|
| `maxDocumentBytes` | 10 MB, expressed as 10 × 1024 × 1024 | Plan AC's size cap, enforced on bytes. |
| `chunkSize` | 1000 | ADR-9 splitter chunk size, in characters. |
| `chunkOverlap` | 200 | ADR-9 splitter overlap budget — an upper bound, see E2-T03. |
| `pastedTextTitle` | the literal `pasted-text` | `title` used when there is no filename. |

### Error vocabulary added this sprint

`src/errors/documentErrors.ts` — one exported factory function per row, each
returning an `AppError` built with the status, code, message and details below.
Keeping them in one module is what stops the code vocabulary from drifting
across four services. The factory takes whatever the `details` column needs
(the offending byte count, the filename, the underlying error, the problem
description).

| Factory | Status | `code` | User-facing message | `details` |
|---|---|---|---|---|
| `emptyDocumentError` | 400 | `EMPTY_DOCUMENT` | `Document contains no readable text.` — the PDF path appends `It may be a scanned image.` | — |
| `documentTooLargeError` | 413 | `DOCUMENT_TOO_LARGE` | `Document is larger than the 10MB limit.` | the actual byte count and the configured maximum |
| `unsupportedFileTypeError` | 415 | `UNSUPPORTED_FILE_TYPE` | `Only PDF and plain text files are supported.` | the filename |
| `pdfParseError` | 400 | `PDF_PARSE_FAILED` | `Could not read this PDF file. It may be corrupted or password-protected.` | a `reason` holding only the underlying error's *name* |
| `chunkValidationError` | 500 | `CHUNK_VALIDATION_FAILED` | `Document processing produced invalid chunks.` | a `problem` string naming the offending field and chunk index |
| `documentProcessingError` | 500 | `DOCUMENT_PROCESSING_FAILED` | `Document processing failed.` (generic wrapper for non-`AppError` throws) | — |

Underlying library messages and stacks are **logged, never returned**
(ADR-5); only the error-name-level `reason` crosses the boundary. The existing
error handler already maps any `AppError` status, so 413 and 415 need no
middleware change.

---

### E2-T01 — Plain Text Document Ingestion

**New dependencies: none.** Pure TypeScript.

**What to build.** In `src/services/textIngestion.service.ts`, an exported
**synchronous** function `ingestText` (there is no I/O) that takes one input
object and returns a `NormalizedDocument`. The input has two properties: the
content, which is either a string (pasted text) or a byte array (an uploaded
`.txt` file), and an **optional** filename — whose *absence* is what marks the
input as pasted text.

Also export from the same module a small helper, `normalizeText`, that takes a
raw string and returns the normalised string (step 3 below). T02 reuses it per
page, and it is worth testing on its own.

**Algorithm, in this order:**

1. **Size check first, on bytes, before decoding.** For a byte array use its
   byte length; for a string measure its UTF-8 byte length (Node's
   `Buffer.byteLength`, *not* `String.length`). Over `maxDocumentBytes` → throw
   `documentTooLargeError`. Checking before normalisation avoids building a
   second 10 MB string for a document we are about to reject.
2. **Decode** a byte array as UTF-8 using a non-fatal `TextDecoder`, so
   undecodable bytes become the replacement character rather than an exception
   — a PoC accepts slightly mangled text over refusing the upload.
3. **Normalise** — this is the whole "normalized" in the ticket title, and it
   is exactly these four operations, in order: strip a leading byte-order mark;
   convert CRLF to LF; convert any remaining bare CR to LF; trim leading and
   trailing whitespace. Nothing else — no whitespace collapsing, no case or
   punctuation changes, interior blank lines preserved. The CRLF conversion is
   load-bearing: it makes ADR-9's blank-line separator behave identically for
   Windows-authored `.txt` files.
4. **Emptiness check on the normalised text** — if it is the empty string,
   throw `emptyDocumentError`. This is what makes whitespace-only input fail
   instead of producing an empty document.
5. **Build the `NormalizedDocument`**: `id` from `randomUUID` (`node:crypto`);
   `title` = the filename if present, otherwise `DOCUMENT_PROCESSING.pastedTextTitle`;
   `sourceType` = `'text-file'` when a filename was supplied, `'pasted-text'`
   otherwise; `segments` = a single segment with `pageNumber` `null` and the
   normalised text; `text` = the normalised text; `pageCount` = `null`;
   `charCount` = the text length; `uploadedAt` = the current time as an ISO
   string.

**Unit tests — `tests/services/textIngestion.test.ts`** must assert:
- Pasted string input yields `sourceType` `'pasted-text'`, `title`
  `'pasted-text'`, `pageCount` `null`, exactly one segment, that segment's
  `pageNumber` `null`, the segment text identical to the document's `text`,
  `charCount` equal to the text length, and — for input that is already trimmed
  and LF-only — text preserved exactly as given.
- Byte-array input with a filename of `notes.txt` (encode the string with
  `TextEncoder`) yields `sourceType` `'text-file'`, that filename as `title`,
  and correctly decoded text.
- `uploadedAt` round-trips: parsing it as a date and re-serialising it to an
  ISO string returns the same string.
- `id` is a non-empty string, and two calls produce different ids.
- Empty-input rejection, one case each: the empty string, spaces only, a mix of
  newlines/tabs/CR, and an empty byte array. Each must throw an `AppError`
  whose `code` is `EMPTY_DOCUMENT`.
- Normalisation: CRLF and bare CR both become LF; a leading byte-order mark is
  gone; leading and trailing blank lines are trimmed while an **interior** blank
  line survives.
- Size: one byte over `maxDocumentBytes` throws with code
  `DOCUMENT_TOO_LARGE`; and a multi-byte string (e.g. built from an accented
  character) whose *character* count is under the cap but whose *byte* count is
  over it must also be rejected — this is the assertion that catches a
  `String.length` implementation.
- One happy-path case at exactly `maxDocumentBytes` succeeds. It runs in
  milliseconds because ingestion does no chunking.

**Verify:** `pnpm --filter backend test`, `pnpm --filter backend typecheck`,
then `pnpm --filter backend build && pnpm --filter backend start` (still boots —
this is what catches a missing `.js` import extension).

Estimated diff: ~230 lines (~110 src across three files, ~120 tests). If it
runs past 250, split as T01a (`document.types.ts` + `documentErrors.ts` +
`normalizeText` + its tests) and T01b (`ingestText` + its tests).

---

### E2-T02 — PDF Text Extraction

**New dependency: `pdf-parse@^2.4.5`** (ADR-10 — v2's class API. Anything that
looks like calling a default-exported `pdfParse` function on a buffer is v1 and
is wrong here).

**What to build.** In `src/services/pdfIngestion.service.ts`, an exported
**async** function `ingestPdf` that takes an input object with the PDF's byte
content and its filename (both required) and resolves to a
`NormalizedDocument`.

**Algorithm, in this order:**

1. **Size check** on the content's byte length → `documentTooLargeError`. This
   must run *before* any parsing (see the test that pins the ordering).
2. Construct a `PDFParse` instance with the bytes passed as its `data` option —
   as a `Uint8Array`, not a `Buffer`, since pdfjs takes ownership of the typed
   array — and `await` its `getText()`. Do this inside a `try`, with
   **`await parser.destroy()` in a `finally`**, on the success *and* failure
   paths. A leaked pdf.js worker turns `pnpm test` into a hang instead of a
   failure.
3. On a caught error: log the real error via the shared logger (include the
   error and the filename), then throw `pdfParseError` with the caught error as
   its cause. Nothing pdfjs-shaped escapes this module.
4. Map the library result — it exposes a page total, a joined text, and an
   array of per-page entries each carrying a 1-based page number and that
   page's text — onto `segments`: one segment per page entry, in order,
   `pageNumber` from the library's page number, `text` passed through
   `normalizeText` from T01. **Keep every page**, including text-free ones, so
   `segments.length` always equals `pageCount`. Set `pageCount` from the
   library's page total.
5. Build `text` yourself by joining the segment texts with a **blank line**
   between them, rather than using the library's own joined text, so the page
   separator is exactly the splitter's paragraph separator. If the result is
   blank after trimming, throw `emptyDocumentError` with the scanned-image
   hint — an image-only PDF is the realistic case.
6. Fill the remaining fields as in T01, with `sourceType` `'pdf'` and `title`
   set to the passed filename.

**Test fixtures.** Two small PDFs are committed under `backend/tests/fixtures/`.
Generate them **once, outside the repo** — create a throwaway directory, install
a PDF-authoring library such as `pdf-lib` there, write a short throwaway script,
run it, and copy the two output files into the fixtures directory. Do **not**
add a PDF-authoring dependency to `backend/package.json`, and do not commit the
throwaway script.

- `sample-3page.pdf` — three pages. Each page must begin with a marker line
  that names its own page number in a form the tests can search for (page 1
  carries a marker unique to page 1, and so on), and must carry at least
  ~1400 characters of text unique to that page, so that every page yields two
  or more chunks in T03/T04.
- `blank.pdf` — a single page with no text drawn on it at all.

Load fixtures in tests by resolving their path relative to the test file's own
module URL (`import.meta.url`) — ESM has no `__dirname`, and a
working-directory-relative path breaks depending on where the runner is
invoked. The corrupt-file cases need no fixture: a byte buffer holding the
ASCII text `%PDF-1.4 not a real pdf`, and one holding ordinary prose, both
produce pdfjs's invalid-PDF exception (verified).

**Unit tests — `tests/services/pdfIngestion.test.ts`** must assert:
- `sample-3page.pdf` gives `pageCount` 3, three segments, segment page numbers
  1, 2 and 3 in order, and — the important one — each segment's text contains
  **its own** page marker and **none of the other pages'** markers. A
  page-count check alone passes even when the text is misattributed.
- No data loss: the document's `text` contains all three page markers, and
  `charCount` equals the `text` length.
- `sourceType` is `'pdf'`, `title` is the filename passed in, and `uploadedAt`
  round-trips as in T01.
- Corrupt input and a non-PDF body both reject with an `AppError` whose `code`
  is `PDF_PARSE_FAILED` and status is 400 — and whose *message* does not
  contain the library's exception name (that belongs in `details.reason`).
- `blank.pdf` rejects with code `EMPTY_DOCUMENT`.
- An over-size buffer rejects with `DOCUMENT_TOO_LARGE` **without** invoking
  the parser. A 10 MB-plus array of zero bytes is not a valid PDF, so if the
  size check ran second the code would be `PDF_PARSE_FAILED` — this test
  therefore also pins step 1's ordering.
- Performance guard: extracting `sample-3page.pdf` finishes in under 2000 ms
  (measured ~213 ms cold, ~13 ms warm for ten pages). A deliberately loose
  smoke guard, not a benchmark.
- The test file leaves no open handle — `pnpm test` exiting on its own is part
  of the acceptance here.

**Verify:** `pnpm --filter backend test` (and confirm the process exits, ~1 s);
`typecheck`; `build` + `start`; and manually run one real ~10-page PDF and one
real ~10 MB PDF through `ingestPdf` once, to cover the epic's under-2-seconds
and 10 MB criteria — committing a 10 MB fixture is not acceptable.

Estimated diff: ~170 lines (~70 src, ~100 tests) plus the two binary fixtures.

---

### E2-T03 — Document Chunking Service

**New dependencies: `@langchain/textsplitters@^1.0.1` and
`@langchain/core@^1.2.9`** (ADR-9 — `core` is a runtime peer, so list it
explicitly; do **not** add the `langchain` meta-package).

**What to build.** In `src/services/chunking.service.ts`, an exported **async**
function `chunkDocument` that takes a `NormalizedDocument` and resolves to an
ordered array of `Chunk`s.

**Algorithm:**

1. Create one `RecursiveCharacterTextSplitter` per call, configured with
   `DOCUMENT_PROCESSING.chunkSize` and `DOCUMENT_PROCESSING.chunkOverlap`
   (cheap, stateless, keeps the function pure). **Leave the default separators
   alone.**
2. Iterate `document.segments` **in order**. For each segment, `await` the
   splitter's `splitText` on that segment's text — the method that returns
   plain strings. Use only `splitText`: not `createDocuments`, not
   `splitDocuments`, and do not import LangChain's `Document` type (ADR-9 — its
   metadata is typed as `any`).
3. For each returned string, append a `Chunk` using a **single running counter**
   across the whole document as `index`, the document-id-plus-`#`-plus-index
   form as `id`, the document's `id` as `documentId`, and metadata built from
   the document's `title`, `sourceType` and `uploadedAt` plus **the current
   segment's** `pageNumber`. The page number always comes from the segment,
   never from inspecting the chunk text (ADR-11).
4. A segment whose text is empty needs no special case: the splitter returns an
   empty array for empty input (verified), so a text-free PDF page simply
   contributes no chunks.
5. Log once at debug level at the end, with the document id and the chunk
   count. No other logging in this service.

**Overlap is an upper bound, not a guarantee — read this before writing the
tests.** Measured at 1000/200:
- One long paragraph of unique words with no blank lines → chunk sizes
  995, 995, 995, 995, 995, 809, with **197** characters of overlap between
  every consecutive pair.
- Eight paragraphs joined by blank lines → four chunks of 840 characters with
  **0** overlap, because the merge unit is a whole paragraph longer than the
  overlap budget.

So: **assert overlap only on a fixture with no blank lines.** Asserting ~200
characters of overlap on a multi-paragraph fixture will fail against correct
code. ADR-9 has the full explanation, and the Reviewer should read it before
judging this ticket against the plan's "~200-character overlap" wording.

**Unit tests — `tests/services/chunking.test.ts`** must assert:
- **Multi-chunk with overlap.** Use a ~4800-character single-paragraph document
  built from *unique* tokens (e.g. `w0000 w0001 …`) — repeated filler text makes
  any overlap measurement meaningless, because a periodic string matches itself
  at almost any offset. Assert: more than one chunk; every chunk at most 1000
  characters; for each consecutive pair, the tail of the earlier chunk equals
  the head of the later one for some length greater than 0 and at most 200; and
  that no input token is missing across the chunks taken together.
- **Ordering and attribution.** The chunk indexes are 0 up to n−1 in order;
  every chunk's `documentId` is the document's id; every chunk's `id` matches
  the document-id-plus-index convention; `metadata.source` is the document
  title; `metadata.uploadedAt` is the document's timestamp.
- **Page propagation.** Build a `NormalizedDocument` **by hand** with three
  segments (page numbers 1, 2 and 3, each holding more than 1400 characters of
  page-unique text). No PDF is needed here — T02 already covers extraction.
  Assert: every chunk containing page 2's marker reports `pageNumber` 2; the
  set of page numbers seen across all chunks is exactly 1, 2, 3; indexes remain
  globally contiguous and in page order; and **no chunk's text spans two
  pages** (no chunk contains markers from two different pages) — the ADR-11
  invariant.
- **Text-source documents carry no page number:** every chunk derived from an
  `ingestText` document reports `pageNumber` `null`.
- **Short document:** a ~200-character document yields exactly one chunk, whose
  text is the document's full text and whose index is 0.
- **A segment with empty text contributes zero chunks**, and the following
  segment's chunks continue the index sequence with no gap.
- Optional: a `tests/helpers/documentFixtures.ts` helper that builds a
  `NormalizedDocument` from a list of segments, if the fixture building repeats.
  T04's tests can reuse it.

**Verify:** `pnpm --filter backend test`; `typecheck`; `build` + `start`; and
`pnpm --filter backend why @langchain/core` to confirm it is a direct
dependency rather than a hoisted peer.

Estimated diff: ~180 lines (~60 src, ~120 tests).

---

### E2-T04 — Chunk Validation & Quality Checks

**New dependencies: none.**

**What to build, part 1 — the validator.** In
`src/services/chunkValidation.service.ts`, an exported **synchronous** function
`validateChunks` that takes the expected document id and an array of `Chunk`s
and returns a validated array of `Chunk`s. It runs these steps in order:

1. **Reject on invariant violation** by throwing `chunkValidationError` (status
   500 — our own chunker produced these chunks, so a violation is a bug, not
   user input). A chunk is invalid when any of the following holds:
   `metadata` is absent; `metadata.source` is not a non-empty string;
   `documentId` is not a non-empty string, or does not match the document id
   passed in; `index` is not a non-negative integer. The `problem` string names
   the offending field and the chunk's index; it lands in the error's `details`
   and is logged.
2. **Filter out** chunks whose text is empty or whitespace-only. If any were
   dropped, log a warning with the document id and the number dropped.
3. **Renumber** the survivors so indexes are contiguous from 0 and each `id` is
   rebuilt from the document id and the new index. Return **new** chunk
   objects; never mutate the input array or its elements. This makes "a chunk's
   `index` equals its position in the array" a guaranteed post-condition for
   everything downstream — say so in a doc comment above the function, since
   the name "validate" does not imply renumbering.
4. If **zero** chunks survive, throw `emptyDocumentError`. A document that
   produces no usable chunks is not a success.

The empty-chunk filter is deliberately defensive: the ADR-9 splitter never
emits an empty string (verified — it returns an empty array for empty input),
so **this branch cannot be reached end-to-end**. Test it by calling
`validateChunks` directly with a hand-built list. Do not contort the pipeline
into producing one.

**What to build, part 2 — the pipeline.** In
`src/services/documentPipeline.service.ts`, the single entry point E4 will call,
and the thing that makes validation automatic instead of a step a caller can
forget. Two exported **async** functions, each resolving to a
`ProcessedDocument`:

- `processPastedText` — takes the pasted text as a string; ingests it as text,
  chunks it, validates the chunks.
- `processFile` — takes a file object with a filename, byte content, and an
  optional MIME type; routes it to the right ingestion path, then chunks and
  validates.

Routing rules for `processFile`: decide on the **lower-cased filename
extension first**, falling back to the MIME type only when the extension is
absent or unrecognised (multer's MIME types are unreliable). A `.pdf`
extension or the PDF MIME type takes the PDF path; `.txt` or `.md`, or any
`text/*` MIME type, takes the text path with the filename passed through;
anything else throws `unsupportedFileTypeError`. This routing lives here, not
in E4's route handler, so it is unit-testable without HTTP.

Both functions wrap the whole sequence: an `AppError` propagates **unchanged**
(it already carries the right code and status); any other thrown value is
logged and re-thrown as `documentProcessingError`. Log once at info level on
success with the document id, source type and chunk count.

**No partial results, ever.** The `ProcessedDocument` is assembled and returned
only after validation passes, so a mid-pipeline failure can only surface as a
rejected promise — there is no intermediate state for a caller to
misinterpret. Nothing is stored here; E4 stores the result in the session only
on success.

**Why there is no `Result`/`Either` type.** The plan's wording ("the caller
receives a clear failure result") is satisfied by a rejected promise carrying an
`AppError`: ADR-5 already routes any `AppError` to one JSON envelope with the
right status code, and sprint 1 fixed "services signal failure by throwing
`AppError`" as the layering rule. Introducing a result-wrapper type here would
create a second, parallel error channel that E4's routes would have to unwrap
and re-throw into the first one — more code, two ways to fail, and no reviewer
benefit. This is an application of ADR-5, not a new decision, so it gets no ADR
of its own.

**Unit tests — `tests/services/chunkValidation.test.ts`** must assert:
- Empty and whitespace-only chunks are dropped: from a hand-built list of four
  chunks where the second has empty text and the third is whitespace-only, two
  chunks come back, both with non-empty text, with indexes 0 and 1, with `id`s
  rebuilt to match, and with the surviving chunks' text unchanged.
- The input array is not mutated — it still has four entries with their
  original index values afterwards.
- Invalid metadata throws, one case each: an empty `metadata.source`; an empty
  `documentId`; a `documentId` that disagrees with the argument; a negative
  `index`; a fractional `index`. Each asserts code `CHUNK_VALIDATION_FAILED`,
  status 500, and that `details.problem` names the offending field.
- A valid list passes through unchanged (deep equality), so validation is not
  silently rewriting good data.
- An empty input list, and a list in which every chunk is filtered out, both
  throw `EMPTY_DOCUMENT`.

**Unit tests — `tests/services/documentPipeline.test.ts`** — the end-to-end
flows, still with no HTTP:
- Valid pasted text of ~4800 characters resolves; `sourceType` is
  `'pasted-text'`; chunk indexes are contiguous from 0; no chunk is empty;
  every chunk reports `pageNumber` `null`; no chunk exceeds 1000 characters.
- `processFile` with `sample-3page.pdf` yields chunks spanning page numbers 1,
  2 and 3, contiguous indexes, and `pageCount` 3 — the extract → chunk →
  validate happy path.
- `processFile` with a `.txt` filename and byte content takes the text path and
  reports `sourceType` `'text-file'`.
- `processFile` with a corrupt `.pdf` body rejects with `PDF_PARSE_FAILED`, and
  the rejection value is an `AppError` rather than a raw pdfjs error — this is
  the "mid-pipeline failure surfaces as a clear error, not a partial success"
  assertion. Assert only that the call rejects; there is no internal state to
  inspect, by design.
- `processFile` with `report.docx` and with `image.png` rejects with
  `UNSUPPORTED_FILE_TYPE` (415) *before* any parsing is attempted.
- Pasted whitespace-only text rejects with `EMPTY_DOCUMENT`.
- The extension beats a contradicting MIME type: a `notes.txt` filename sent
  with a PDF MIME type takes the text path.
- Optionally, a routing decision made from the MIME type alone, for a filename
  with no extension.

**Deliberately not validated** (say no to these in review): a maximum
chunk-length check (the splitter is measured to respect the chunk size, and a
hard throw there would add a failure mode for no observed problem), duplicate
chunk detection (plan: out of scope), and language or encoding detection.

**Verify:** `pnpm --filter backend test`; `typecheck`; `build` + `start`; and
as a one-off manual check, temporarily make the chunker emit one empty-text
chunk and confirm the pipeline still returns clean chunks, then revert it.

Estimated diff: ~250 lines (~110 src, ~140 tests). If it runs past 250, split
as T04a (`chunkValidation.service.ts` + its tests) and T04b
(`documentPipeline.service.ts` + its tests) — a clean seam, since the pipeline
imports the validator.

## Data / Schema Changes
**None** — no database, no persistence, no in-memory store yet (`CLAUDE.md`:
in-memory PoC; the session store arrives in E4). This sprint adds *type* shapes
only, listed under *Shared shapes* above; nothing is written anywhere. The
`NormalizedDocument` and `Chunk` shapes are the de-facto schema E3's vector
store and E4's session store will both hold, which is why they are defined once
in `document.types.ts` and kept JSON-serialisable.

## API / Interface Changes
**No HTTP surface changes.** No route is added, removed, or altered this sprint;
`src/app.ts`, `src/routes/*` and the middleware stack are untouched. `GET
/health` and the ADR-5 error envelope are exactly as sprint 1 left them.

**New internal interfaces (what E3 and E4 build on):**

| Export | Module | Takes → returns |
|---|---|---|
| `ingestText` | `services/textIngestion.service.ts` | content (string or bytes) + optional filename → `NormalizedDocument`, synchronously |
| `normalizeText` | `services/textIngestion.service.ts` | a raw string → the normalised string |
| `ingestPdf` | `services/pdfIngestion.service.ts` | PDF bytes + filename → a promise of `NormalizedDocument` |
| `chunkDocument` | `services/chunking.service.ts` | a `NormalizedDocument` → a promise of an ordered `Chunk` array |
| `validateChunks` | `services/chunkValidation.service.ts` | expected document id + `Chunk` array → a validated, renumbered `Chunk` array, synchronously |
| `processPastedText` | `services/documentPipeline.service.ts` | pasted text → a promise of `ProcessedDocument` |
| `processFile` | `services/documentPipeline.service.ts` | filename + bytes + optional MIME type → a promise of `ProcessedDocument` |
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

1. **`processPastedText` and `processFile` are the only entry points E4 should
   call.** Do not call `ingestPdf` and then `chunkDocument` by hand from a
   route: validation is wired into the pipeline (T04's AC), and bypassing it
   bypasses the AC. E4's route parses multipart, enforces the
   three-documents-per-session rule, and hands over the filename, bytes and
   MIME type.
2. **The 10 MB cap is enforced in the service**
   (`DOCUMENT_PROCESSING.maxDocumentBytes`). E4 must configure its upload
   middleware's own limit from that same constant — importing it, not
   re-typing the number — so a huge upload is rejected before it is fully
   buffered in memory.
3. **`pageNumber` is a number *or* `null`.** E3's retrieval and citations and
   E6's UI must both handle `null` (pasted text has no pages). Do not paper
   over it by defaulting to page 1.
4. **`Chunk` is our type, not LangChain's `Document`** (ADR-9). E3 converts at
   the embedding boundary — one `Document` per chunk, the chunk text as its
   page content, and its metadata carrying the chunk metadata plus the chunk
   and document ids. Keep that conversion in one place so LangChain's untyped
   metadata surface stays contained.
5. **`@langchain/core@^1.2.9` is now pinned by this sprint.** E3 must add
   `@langchain/langgraph` and `@langchain/openai` at versions compatible with
   core 1.x, and must not add the `langchain` meta-package. Verify against the
   registry at that time, per ADR-6.
6. **Chunk size and overlap are fixed constants, and the overlap is an upper
   bound** (ADR-9). If E3's retrieval quality is poor, the knobs are
   `DOCUMENT_PROCESSING.chunkSize` and `chunkOverlap`, and possibly a
   token-based splitter (`js-tiktoken` already ships with `core`) — one place,
   and it needs an ADR amendment, not a scattered change.
7. **No overlap across page boundaries** (ADR-11), and expect a short tail
   chunk per PDF page. If E3 sees answers cut off exactly at page breaks, that
   is this decision, and the fix is a design change, not a prompt tweak.
8. **`pdf-parse` pulls a native binary** (`@napi-rs/canvas`). E8/CI on a
   different architecture, or any Docker image, must confirm `pnpm install`
   succeeds; ADR-10 records `unpdf` as the verified swap-in if it does not.
9. **`document.text` is display-only.** E6's preview and E4's responses may read
   it; nothing may chunk or embed it — chunking reads `segments` (ADR-11). A
   10 MB document is held in memory twice; if the session store makes that
   hurt, `text` becomes a derived helper.
10. **Every service here is either synchronous or promise-returning,
    framework-free, free of import-time side effects, and needs no injected
    collaborators** — so sprint 1's flag 11 (testability) is satisfied without
    seams. E3's LLM client is the case that *will* need injection (ADR-8); do
    not break this property by reaching for a module-level singleton there.
