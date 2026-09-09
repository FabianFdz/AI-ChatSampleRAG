# ADR-10: Extract PDF text with `pdf-parse` v2's `PDFParse` class

- **Status:** Accepted
- **Date:** 2026-09-08
- **Sprint / Tickets:** Sprint 2 — E2-T02

## Context
E2-T02 needs, from a PDF buffer held in memory: the full text, **per-page text
with page numbers** (the AC is explicit), files up to 10 MB, under 2 s for a
typical document, and a descriptive error instead of a crash on a corrupted
file. Constraints from earlier decisions: ESM + `module: NodeNext` with `.js`
import specifiers (ADR-2), `strict` with no `any` (ADR-6/design rules), and
tests run on `node:test` + `tsx` (ADR-8) — so whatever library is used must not
leave a worker or handle open, or `pnpm test` hangs instead of failing.

`docs/epics/E2-*.md` names `pdf-parse`, and ADR-6 deferred adding it to this
epic "with a version verified against the registry at that time". That check
matters here: `pdf-parse` published a **v2 rewrite** in Oct 2025 (`2.4.5`
current) from the same maintainer as `1.1.1`. v2 is a different package
in practice — TypeScript-native, ESM+CJS dual, bundled types, class-based API,
`pdfjs-dist@5.4.296` as a real dependency.

Candidates were installed and run against generated 3-page / 10-page / corrupt
/ non-PDF fixtures before this ADR was written.

## Decision
Use **`pdf-parse@^2.4.5`**, via its class API:

```
new PDFParse({ data: Uint8Array }) → await parser.getText() → TextResult
TextResult = { total: number; text: string; pages: Array<{ num: number; text: string }> }
```

Rules for the implementation:
- Always `await parser.destroy()` in a `finally` — including on the failure
  path. (The process happened to exit without it in a lab run, but pdf.js owns
  a worker and document handle; not releasing them is exactly the kind of thing
  that turns `node --test` into a hang.)
- Pass `new Uint8Array(buffer)`, not the `Buffer` — pdfjs takes ownership of
  the typed array.
- Use `getText()` only. `getInfo`, `getImage`, `getTable`, `getScreenshot`, and
  anything OCR/canvas-related are out of scope for E2 and must not be imported.
- Wrap every thrown pdfjs error as `AppError(400, 'PDF_PARSE_FAILED', …)` with
  a fixed user-facing message and the underlying `error.name` in `details`
  (ADR-5: internals are logged, not returned).

### Measured (Node 24, pnpm 11.21, macOS arm64)
| Case | Result |
|---|---|
| 3-page PDF | `total: 3`, `pages[].num = 1,2,3`, first parse ~213 ms (worker warm-up) |
| 10-page PDF | 10 page entries, ~13 ms warm — well inside the 2 s target |
| `%PDF-1.4 not a real pdf` | throws `InvalidPDFException: Invalid PDF structure.` — no crash, no console noise |
| plain text renamed `.pdf` | same `InvalidPDFException` |
| under `node --import tsx --test` | tests pass and the process exits (~0.7 s total) |
| `tsc` 5.9 `strict` + `noUncheckedIndexedAccess` + `@types/node@20` | clean; no `@types/pdf-parse` needed |
| `pnpm add pdf-parse@^2.4.5` | 17 packages, no blocked build scripts (relevant: this repo allow-lists builds in `pnpm-workspace.yaml`) |

`res.text` is the pages joined together; we do not rely on it (see ADR-11).

## Consequences
- Per-page metadata is a first-class field, so E2-T02 needs no `pagerender`
  hook or pdf.js plumbing of our own.
- **Install weight:** `pdfjs-dist` (~36 MB) plus `@napi-rs/canvas` (~24 MB,
  a *native* prebuilt binary) come along even though we only extract text.
- **The native binary is the one real risk.** If a future CI image or container
  arch has no prebuilt `@napi-rs/canvas`, `pnpm install` can fail on a
  dependency we never call. Documented escape hatch, verified working during
  this evaluation: `unpdf` (2.5 MB, pure JS, bundles a serverless pdf.js) with
  `extractText(await getDocumentProxy(data), { mergePages: false })` returns
  `{ totalPages, text: string[] }` — a drop-in for our text-only use. Swap it
  behind `pdfIngestion.service.ts` if that day comes; nothing else changes.
- `pdf-parse` v2 declares `engines: node >=20.16 <21 || >=22.3` — fine on
  Node 24, but it will reject Node 21/22.0–22.2 if anyone pins those.
- Code must **not** use v1's `import pdfParse from 'pdf-parse'` default-function
  style found in most tutorials and in older LLM training data. v1 also runs
  debug code when loaded as CJS from ESM (`module.parent` is null) and tries to
  read a bundled test PDF, which crashes. If a snippet looks like
  `pdfParse(buffer)`, it is v1 — reject it in review.
- Page-count and page text now exist in the normalized document, which E6's
  "preview uploaded content" and E3's source citations can both use.

## Alternatives rejected
- **`pdf-parse@1.1.1`** (the version the epic's authors likely had in mind).
  CJS-only, needs `@types/pdf-parse`, has the `module.parent` debug-mode crash
  under ESM, and gives no per-page text — the AC would require a custom
  `pagerender` callback reaching into pdf.js internals.
- **`unpdf@1.8.1`.** Genuinely attractive: 2.5 MB, no native dependency,
  per-page text, faster cold start (~48 ms), and it worked first try. Rejected
  because it is a thin wrapper around the same pdf.js, it is not the library
  the epic specifies, and it printed pdf.js `Warning: Indexing all PDF objects`
  to the console on corrupt input (noise in test output). Kept as the
  documented fallback above — the gap between the two is small enough that this
  is a reversible decision.
- **`pdfjs-dist` directly.** No wrapper, but then we own worker setup, the
  `getTextContent()` → string assembly, and its `any`-ish types.
- **LangChain's `PDFLoader`.** Consistent with ADR-9's "stay in the LangChain
  lane", and it returns one `Document` per page. Rejected: it lives in
  `@langchain/community`, it wraps `pdf-parse` anyway, and it returns
  `Document<Record<string, any>>` — the same untyped-metadata objection as
  ADR-9.
