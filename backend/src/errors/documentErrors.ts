/**
 * Error vocabulary for the document ingestion / chunking pipeline (E2).
 *
 * Keeping every factory in one module is what stops the error-code
 * vocabulary from drifting across services. Underlying library messages and
 * stacks are logged by the caller, never returned — only the error-name-level
 * `reason` (for `pdfParseError`) crosses the response boundary.
 */

import { AppError } from './AppError.js';

/**
 * The document (or a page of it) contains no readable text.
 * @param scannedImageHint - set for the PDF path, whose message appends a
 * scanned-image hint.
 */
export function emptyDocumentError(scannedImageHint = false): AppError {
  const message = scannedImageHint
    ? 'Document contains no readable text. It may be a scanned image.'
    : 'Document contains no readable text.';
  return new AppError(400, 'EMPTY_DOCUMENT', message);
}

/** The document exceeds `DOCUMENT_PROCESSING.maxDocumentBytes`. */
export function documentTooLargeError(
  byteCount: number,
  maxBytes: number,
): AppError {
  return new AppError(
    413,
    'DOCUMENT_TOO_LARGE',
    'Document is larger than the 10MB limit.',
    { byteCount, maxBytes },
  );
}

/** The uploaded file is neither a PDF nor a plain text file. */
export function unsupportedFileTypeError(filename: string): AppError {
  return new AppError(
    415,
    'UNSUPPORTED_FILE_TYPE',
    'Only PDF and plain text files are supported.',
    { filename },
  );
}

/** The PDF could not be parsed (corrupted, password-protected, not a PDF). */
export function pdfParseError(cause: unknown): AppError {
  const reason = cause instanceof Error ? cause.name : 'UnknownError';
  return new AppError(
    400,
    'PDF_PARSE_FAILED',
    'Could not read this PDF file. It may be corrupted or password-protected.',
    { reason },
  );
}

/** The chunker produced chunks that violate the `Chunk` invariants. */
export function chunkValidationError(problem: string): AppError {
  return new AppError(
    500,
    'CHUNK_VALIDATION_FAILED',
    'Document processing produced invalid chunks.',
    { problem },
  );
}

/** Generic wrapper for a non-`AppError` throw anywhere in the pipeline. */
export function documentProcessingError(): AppError {
  return new AppError(
    500,
    'DOCUMENT_PROCESSING_FAILED',
    'Document processing failed.',
  );
}
