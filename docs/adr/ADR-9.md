# ADR-9: Chunk with LangChain's `RecursiveCharacterTextSplitter`, not a hand-rolled splitter

- **Status:** Accepted
- **Date:** 2026-09-08
- **Sprint / Tickets:** Sprint 2 — E2-T03

## Context
E2-T03 must split a normalized document into ordered chunks of up to 1000
characters with ~200 characters of overlap (epic E2, plan AC). Two credible
options:

1. Hand-roll a splitter (~40 lines: slide a window, back off to the nearest
   separator, carry the overlap).
2. Use `RecursiveCharacterTextSplitter` from `@langchain/textsplitters`.

The repo's dependency rule (ADR-6) says a package appears in `package.json`
only when something imports it, and `CLAUDE.md`'s PoC stance plus this
project's own precedent (ADR-3 hand-rolled env validation, ADR-4 took the
logging library, ADR-8 took the built-in test runner over Vitest) means the
choice has to be argued, not assumed.

The decisive context is downstream: `CLAUDE.md` already commits the RAG engine
(E3) to **LangChain + LangGraph**, and chunks feed straight into LangChain
embeddings and a LangChain vector store. `@langchain/core` will be installed in
E3 regardless.

Everything below was measured against the real packages before this ADR was
written (`@langchain/textsplitters@1.0.1`, `@langchain/core@1.2.9`, Node 24,
pnpm 11.21), not taken from documentation.

## Decision
Use `RecursiveCharacterTextSplitter` with `{ chunkSize: 1000, chunkOverlap: 200 }`.

- Dependencies added in E2-T03: `@langchain/textsplitters@^1.0.1` **and**
  `@langchain/core@^1.2.9`. `core` is a declared peer of `textsplitters` and is
  imported at runtime (`@langchain/core/documents`), so it is listed explicitly
  rather than relying on the package manager to hoist a peer.
- Use **only `splitter.splitText(text): Promise<string[]>`**. Do *not* use
  `createDocuments()` and do *not* adopt LangChain's `Document` as our chunk
  type: `Document<Metadata extends Record<string, any>>` defaults to untyped
  metadata, so reading `doc.metadata.pageNumber` yields `any` — banned by this
  repo's `strict`/no-`any` rule. Our own `Chunk` interface stays typed, and E3
  converts `Chunk` → `Document` at the embedding boundary in one line.
- The splitter is a pure, deterministic collaborator constructed inside the
  chunking service. No injection seam is needed (contrast ADR-8's requirement
  for E3's LLM client, which does I/O).

### Measured behaviour the implementation and its tests must assume
| Input | Result |
|---|---|
| 4799 chars, unique words, no blank lines | 6 chunks, sizes ≤ 1000 (`995,995,995,995,995,809`), overlap **197** between each pair |
| 3366 chars, 8 paragraphs separated by `\n\n` | 4 chunks of 840, overlap **0** |
| 2500 chars with no separator at all | 3 chunks: `1000,1000,900` (sums to 2900 = 2500 + 2×200 overlap) — never exceeds `chunkSize` |
| `''` or `'   \n\n \t '` | `[]` — the splitter never emits an empty or whitespace-only chunk |
| 10 MB of text | 13 618 chunks in ~276 ms |

The zero-overlap row is the non-obvious one and it is **intended library
behaviour**, not a bug: the splitter recurses only into splits longer than
`chunkSize`, then merges adjacent splits and keeps at most `chunkOverlap`
characters of tail. When the merge unit is a whole paragraph longer than 200
characters, nothing is carried over, so consecutive chunks that meet at a
paragraph break have **0** overlap. `chunkOverlap: 200` is therefore an *upper
bound*, realised at word granularity inside a paragraph.

This is the reading of the AC "~200-character overlap" that E2-T03 implements,
and tests must assert overlap only on a fixture with no blank lines (see
`design.md`).

## Consequences
- Overlap semantics are the library's, not ours: "at most 200 characters, taken
  at the nearest separator boundary". A reviewer must not fail E2-T03 for a
  paragraph-boundary chunk pair with no overlap.
- Install weight lands one epic early: `@langchain/core` brings `zod`,
  `langsmith`, `js-tiktoken`, `p-queue`, `mustache`, `@cfworker/json-schema`
  (~50 MB of `node_modules`; `textsplitters` itself is 148 KB). Justified only
  because E3 needs `core` anyway — the marginal cost of the splitter is the
  148 KB.
- **Do not** add the `langchain` meta-package (ADR-6's table lists it
  speculatively). `@langchain/textsplitters` + `@langchain/core` is the whole
  need; E3 adds `@langchain/langgraph`, `@langchain/anthropic` (Claude), and
  a Voyage AI client (embeddings) itself.
- Chunk size/overlap stay hard-coded constants, not env config (plan defers
  tuning to E3). `js-tiktoken` is already present via `core`, so switching to
  token-based sizing later costs no new dependency.
- Node ≥ 20 is required by both packages; the project is on Node 24.

## Alternatives rejected
- **Hand-rolled splitter (~40 lines).** The option this project's own
  precedent (ADR-3) would normally favour, and it would keep chunk boundaries
  fully under our control. Rejected because the code it replaces is the
  fiddly part (multi-level separator back-off, overlap carry, degenerate inputs
  with no separators), because it would be a *second* chunking implementation
  sitting next to the LangChain retrieval pipeline it feeds in E3, and because
  `@langchain/core` is arriving in E3 regardless — so the "avoid a heavy
  dependency" argument that won in ADR-3 and ADR-8 does not apply here.
- **`createDocuments()` + LangChain `Document` as our chunk type.** Fewer lines
  (it splits per text and attaches per-text metadata, plus free
  `loc.lines.from/to`), and it is what LangChain's own loaders return.
  Rejected on typing: `metadata` is `Record<string, any>`, which puts `any` in
  the middle of the pipeline every later epic reads from.
- **`TokenTextSplitter` / token-based sizing.** Better aligned with an LLM
  context window, but the AC is specified in characters and no retrieval
  quality problem has been observed yet. Revisit in E3 if it has.
- **Splitting the whole document text with char-offset mapping back to pages.**
  See ADR-11 — the splitter trims chunks and drops separators, so chunks are
  not reliable substrings of the input.
