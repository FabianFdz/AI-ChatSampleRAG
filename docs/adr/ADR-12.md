# ADR-12: Session vector search is brute-force cosine similarity over a plain array, not LanceDB

- **Status:** Accepted
- **Date:** 2026-09-09
- **Sprint / Tickets:** Sprint 3 — E3-T02

## Context
The E3 epic file names **LanceDB** in its Scope line ("In-memory vector store
(LanceDB) for document indexing") and lists "Vector DB: LanceDB vs.
alternatives (Pinecone, Weaviate)?" on its *To settle* list. The plan's Open
Questions section treats the Scope line as having already settled it. Before
designing on top of that, the actual cost of the choice was measured.

What E3-T02 has to do is narrow: hold **one session's** embedded chunks (E2
produces a few dozen chunks for a typical 1–3 document upload), score a query
vector against them, return the top 3 above a relevance threshold, and never
mix two sessions' chunks. Nothing is persisted (`CLAUDE.md`: in-memory PoC, no
database), nothing is shared across processes, and there is no metadata
filtering, no hybrid search and no re-ranking in scope.

Both candidates were measured on this machine (Node 24, pnpm 11.21, macOS
arm64):

| Option | Measured cost |
|---|---|
| `@lancedb/lancedb@0.38.0` | **595 MB** of `node_modules` — a 221 MB platform-specific native binary (`@lancedb/lancedb-darwin-arm64`), plus `onnxruntime-node` (180 MB), `onnxruntime-web` (92 MB), `@huggingface/transformers` (37 MB) and `sharp`. `pnpm` additionally refuses three postinstall build scripts until `pnpm approve-builds` is run. |
| Brute-force dot product over pre-normalised vectors | 0 dependencies. Top-3 search over 1024-dimension vectors: **0.07 ms at 30 vectors**, 0.12 ms at 100, 1.3 ms at 1000, **11 ms at 13 618** (the chunk count ADR-9 measured for a full 10 MB document). |

The epic's response-time criterion is **under 3 seconds end-to-end**, of which
the Claude round-trip is ~1–2 s and the Voyage query embedding is a further
network hop. Search is four orders of magnitude away from being the
bottleneck at realistic session sizes.

## Decision
Implement the session vector index as a **plain in-memory structure with
brute-force cosine similarity**, in `src/services/vectorIndex.service.ts`. No
vector-database dependency is added in E3.

- Vectors are **normalised to unit length once, at insert time**, and the query
  vector once at search time, so scoring is a plain dot product and cosine
  similarity falls out of it directly. Do not rely on Voyage returning
  normalised vectors — normalise defensively, in our own code, in one place.
- Every vector in a session's index must have the same dimension as the others.
  A mismatch is our own bug (a model changed mid-session), not user input, so it
  throws (`EMBEDDING_DIMENSION_MISMATCH`, 500) rather than silently producing
  meaningless scores.
- Search returns at most `RAG.topK` results, ordered by descending score, after
  dropping everything below `RAG.minRelevanceScore` — so an off-topic query
  legitimately returns fewer than 3, or zero.
- Indexes are keyed by session id inside the session-state registry (ADR-15).
  There is one index per session and no global index, which is what makes
  cross-session leakage structurally impossible rather than a filter that could
  be forgotten.

## Consequences
- Zero new dependencies for E3-T02, zero native binaries, and no
  `pnpm approve-builds` step in a project that already carries one native
  binary risk (`@napi-rs/canvas` via `pdf-parse`, ADR-10).
- Search is exact, not approximate. There is no index build step, no
  training/quantisation phase, and no recall/latency tuning — an on-topic query
  cannot miss a chunk because of an ANN structure.
- Scoring is fully deterministic and dependency-free, so E3-T02's unit tests can
  use **hand-built unit vectors with known dot products** and assert exact
  ordering and threshold behaviour without ever calling Voyage.
- Cost grows linearly with chunk count. The measured 11 ms at 13 618 vectors is
  the worst realistic case (one maximum-size document); if a later epic indexes
  orders of magnitude more, revisit — the swap point is one module with a small
  interface, not a scattered change.
- **`CLAUDE.md`'s Scope line for E3 and the epic file's LanceDB mention are
  superseded by this ADR.** The Documenter should reflect that when closing the
  sprint; the epic's *To settle* "Vector DB" question is answered here.

## Alternatives rejected
- **`@lancedb/lancedb`** (the epic's named choice). It is a genuinely good
  embedded vector database — real ANN indexing, disk persistence, columnar
  storage, metadata filtering. Every one of those capabilities is either out of
  scope (persistence is explicitly excluded by `CLAUDE.md`) or irrelevant at a
  few dozen vectors, and the price is 595 MB and a native binary per platform in
  a PoC whose entire current `node_modules` is a fraction of that. This is the
  same trade-off ADR-8 made against Vitest, with a far larger gap.
- **LangChain's `MemoryVectorStore`.** Semantically the closest match — it is
  literally brute-force cosine over an array — but it ships in the `langchain`
  meta-package, which ADR-9 explicitly decided not to add, and it would put
  LangChain's `Document` (with its `Record<string, any>` metadata) back in the
  middle of the retrieval path that ADR-9 kept typed. It saves roughly twenty
  lines of arithmetic at the cost of the project's one clean typing boundary.
- **A hosted vector DB (Pinecone, Weaviate).** Network dependency, an account,
  a second API key and per-session index lifecycle management, for a PoC that
  discards all state on restart by design.
