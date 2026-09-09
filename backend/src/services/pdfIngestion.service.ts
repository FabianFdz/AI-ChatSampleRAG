import { randomUUID } from 'node:crypto';

import { PDFParse } from 'pdf-parse';

import {
  documentTooLargeError,
  emptyDocumentError,
  pdfParseError,
} from '../errors/documentErrors.js';
import { logger } from '../utils/logger.js';
import { DOCUMENT_PROCESSING } from './document.types.js';
import type { DocumentSegment, NormalizedDocument } from './document.types.js';
import { normalizeText } from './textIngestion.service.js';

export interface IngestPdfInput {
  /** The PDF's raw byte content. */
  content: Uint8Array;
  /** The uploaded filename, used as the document's `title`. */
  filename: string;
}

/**
 * Extracts text from a PDF's bytes into a `NormalizedDocument`, one segment
 * per page (ADR-11). Async — pdf-parse v2's `PDFParse` class does the actual
 * parsing (ADR-10).
 */
export async function ingestPdf(
  input: IngestPdfInput,
): Promise<NormalizedDocument> {
  const { content, filename } = input;

  const size = content.byteLength;
  if (size > DOCUMENT_PROCESSING.maxDocumentBytes) {
    throw documentTooLargeError(size, DOCUMENT_PROCESSING.maxDocumentBytes);
  }

  const parser = new PDFParse({ data: new Uint8Array(content) });
  let segments: DocumentSegment[];
  let pageCount: number;
  try {
    const result = await parser.getText();
    pageCount = result.total;
    segments = result.pages.map((page) => ({
      pageNumber: page.num,
      text: normalizeText(page.text),
    }));
  } catch (cause) {
    logger.error({ err: cause, filename }, 'Failed to parse PDF');
    throw pdfParseError(cause);
  } finally {
    await parser.destroy();
  }

  const text = segments.map((segment) => segment.text).join('\n\n');
  if (text.trim() === '') {
    throw emptyDocumentError(true);
  }

  return {
    id: randomUUID(),
    title: filename,
    sourceType: 'pdf',
    segments,
    text,
    pageCount,
    charCount: text.length,
    uploadedAt: new Date().toISOString(),
  };
}
