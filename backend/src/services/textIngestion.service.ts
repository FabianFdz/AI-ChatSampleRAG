import { randomUUID } from 'node:crypto';

import {
  documentTooLargeError,
  emptyDocumentError,
} from '../errors/documentErrors.js';
import { DOCUMENT_PROCESSING } from './document.types.js';
import type { NormalizedDocument } from './document.types.js';

const BOM = '\uFEFF';

export interface IngestTextInput {
  /** Pasted text, or the bytes of an uploaded `.txt` file. */
  content: string | Uint8Array;
  /** Present for a file upload; its absence marks the input as pasted text. */
  filename?: string;
}

/**
 * Normalises a raw string: strips a leading byte-order mark, converts CRLF
 * and bare CR to LF, then trims leading and trailing whitespace. Nothing
 * else — no whitespace collapsing, no case or punctuation changes; interior
 * blank lines are preserved.
 */
export function normalizeText(raw: string): string {
  let text = raw;
  if (text.startsWith(BOM)) {
    text = text.slice(BOM.length);
  }
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return text.trim();
}

function byteLength(content: string | Uint8Array): number {
  return typeof content === 'string'
    ? Buffer.byteLength(content, 'utf8')
    : content.byteLength;
}

function decode(content: string | Uint8Array): string {
  if (typeof content === 'string') {
    return content;
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(content);
}

/**
 * Normalises pasted text or an uploaded `.txt` file's bytes into a
 * `NormalizedDocument`. Synchronous — there is no I/O.
 */
export function ingestText(input: IngestTextInput): NormalizedDocument {
  const { content, filename } = input;

  const size = byteLength(content);
  if (size > DOCUMENT_PROCESSING.maxDocumentBytes) {
    throw documentTooLargeError(size, DOCUMENT_PROCESSING.maxDocumentBytes);
  }

  const decoded = decode(content);
  const text = normalizeText(decoded);

  if (text === '') {
    throw emptyDocumentError();
  }

  const title = filename ?? DOCUMENT_PROCESSING.pastedTextTitle;
  const sourceType = filename !== undefined ? 'text-file' : 'pasted-text';

  return {
    id: randomUUID(),
    title,
    sourceType,
    segments: [{ pageNumber: null, text }],
    text,
    pageCount: null,
    charCount: text.length,
    uploadedAt: new Date().toISOString(),
  };
}
