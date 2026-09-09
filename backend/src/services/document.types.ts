/**
 * Shared shapes for the document ingestion / chunking pipeline (E2).
 *
 * Everything here is plain, JSON-serialisable data — no classes, no
 * `Buffer`, no `Date` instances — so the HTTP layer (E4) can return it from a
 * route without a mapping layer.
 */

/** Which ingestion path produced a `NormalizedDocument`. */
export type DocumentSourceType = 'pasted-text' | 'text-file' | 'pdf';

/**
 * One unit of source text that shares a single page attribution. This is the
 * unit the chunker splits.
 */
export interface DocumentSegment {
  /** The PDF page this text came from; `null` for text sources (no pages). */
  pageNumber: number | null;
  /** The segment's normalised text. May be empty (a PDF page with no extractable text). */
  text: string;
}

/** The single shape both text and PDF ingestion produce. */
export interface NormalizedDocument {
  /** Identity for the document; every chunk references it. */
  id: string;
  /** The uploaded filename, or the pasted-text label for pasted input. */
  title: string;
  /** Which ingestion path produced this. */
  sourceType: DocumentSourceType;
  /**
   * The chunking input. PDF: exactly one entry per page, in page order.
   * Text: exactly one entry.
   */
  segments: DocumentSegment[];
  /**
   * The full text, for display/preview and API responses only — never
   * chunked (ADR-11).
   */
  text: string;
  /** The PDF's page total; `null` for text sources. */
  pageCount: number | null;
  /** Length of `text`. */
  charCount: number;
  /** Upload timestamp (ISO-8601, UTC); copied into every chunk's metadata. */
  uploadedAt: string;
}

/** The source attribution carried by every chunk. */
export interface ChunkMetadata {
  /** The document's `title` — filename or pasted-text label. */
  source: string;
  /** Copied from the document. */
  sourceType: DocumentSourceType;
  /** Copied from the segment the chunk came from, never inferred from the chunk text. */
  pageNumber: number | null;
  /** Copied from the document. */
  uploadedAt: string;
}

/** One embeddable unit. */
export interface Chunk {
  /** Stable chunk identity, derived from the document id and the chunk index. */
  id: string;
  /** The owning document's `id`. */
  documentId: string;
  /** Position within the document, document-wide and contiguous. */
  index: number;
  /** The chunk content, never longer than the configured chunk size. */
  text: string;
  /** Source attribution. */
  metadata: ChunkMetadata;
}

/** The document-processing pipeline's return value (E2-T04). */
export interface ProcessedDocument {
  document: NormalizedDocument;
  chunks: Chunk[];
}

/** The single place the document-processing tuning numbers exist. */
export const DOCUMENT_PROCESSING = Object.freeze({
  /** Plan AC's size cap, enforced on bytes. */
  maxDocumentBytes: 10 * 1024 * 1024,
  /** ADR-9 splitter chunk size, in characters. */
  chunkSize: 1000,
  /** ADR-9 splitter overlap budget — an upper bound, see E2-T03. */
  chunkOverlap: 200,
  /** `title` used when there is no filename. */
  pastedTextTitle: 'pasted-text',
});
