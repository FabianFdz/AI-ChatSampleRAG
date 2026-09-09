/**
 * The single entry point E4's routes should call: ingest -> chunk -> validate.
 *
 * `ingestPdf`/`ingestText` + `chunkDocument` + `validateChunks` are not meant
 * to be called separately from a route — validation is wired into the
 * pipeline here so it can never be forgotten. There is no `Result`/`Either`
 * type: an `AppError` propagating unchanged (or a non-`AppError` throw
 * becoming `documentProcessingError`) via a rejected promise already gives
 * ADR-5's one error envelope, and a wrapper type here would just be a second,
 * parallel error channel for E4 to unwrap.
 */

import { AppError } from '../errors/AppError.js';
import {
  documentProcessingError,
  unsupportedFileTypeError,
} from '../errors/documentErrors.js';
import { logger } from '../utils/logger.js';
import { chunkDocument } from './chunking.service.js';
import { validateChunks } from './chunkValidation.service.js';
import type {
  NormalizedDocument,
  ProcessedDocument,
} from './document.types.js';
import { ingestPdf } from './pdfIngestion.service.js';
import { ingestText } from './textIngestion.service.js';

export interface ProcessFileInput {
  /** The uploaded filename, used for routing and (text path) as the title. */
  filename: string;
  /** The file's raw byte content. */
  content: Uint8Array;
  /** The upload's reported MIME type, used only as a routing fallback. */
  mimeType?: string;
}

const PDF_MIME_TYPE = 'application/pdf';
const TEXT_EXTENSIONS = new Set(['txt', 'md']);

type Route = 'pdf' | 'text';

function extensionOf(filename: string): string | null {
  const lower = filename.toLowerCase();
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === lower.length - 1) {
    return null;
  }
  return lower.slice(dotIndex + 1);
}

/**
 * Decides which ingestion path `processFile` takes: the lower-cased filename
 * extension first, falling back to the MIME type only when the extension is
 * absent or unrecognised (multer's MIME types are unreliable). Throws
 * `unsupportedFileTypeError` when neither signal maps to a known path.
 */
function resolveRoute(filename: string, mimeType: string | undefined): Route {
  const extension = extensionOf(filename);

  if (extension === 'pdf') {
    return 'pdf';
  }
  if (extension !== null && TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }

  if (mimeType === PDF_MIME_TYPE) {
    return 'pdf';
  }
  if (mimeType !== undefined && mimeType.startsWith('text/')) {
    return 'text';
  }

  throw unsupportedFileTypeError(filename);
}

/** Runs `work`, letting an `AppError` through unchanged and wrapping anything else. */
async function runPipeline(
  work: () => Promise<ProcessedDocument>,
): Promise<ProcessedDocument> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    logger.error({ err }, 'document processing failed');
    throw documentProcessingError();
  }
}

/** Chunks and validates a `NormalizedDocument`, logging once on success. */
async function finishPipeline(
  document: NormalizedDocument,
): Promise<ProcessedDocument> {
  const chunks = await chunkDocument(document);
  const validated = validateChunks(document.id, chunks);

  logger.info(
    {
      documentId: document.id,
      sourceType: document.sourceType,
      chunkCount: validated.length,
    },
    'processed document',
  );

  return { document, chunks: validated };
}

/**
 * Ingests, chunks and validates pasted text. `AppError`s propagate unchanged;
 * any other throw is logged and re-thrown as `documentProcessingError`.
 */
export async function processPastedText(
  text: string,
): Promise<ProcessedDocument> {
  return runPipeline(() => {
    const document = ingestText({ content: text });
    return finishPipeline(document);
  });
}

/**
 * Routes an uploaded file to the PDF or text ingestion path, then chunks and
 * validates it. `AppError`s propagate unchanged; any other throw is logged
 * and re-thrown as `documentProcessingError`.
 */
export async function processFile(
  input: ProcessFileInput,
): Promise<ProcessedDocument> {
  const { filename, content, mimeType } = input;

  return runPipeline(async () => {
    const route = resolveRoute(filename, mimeType);
    const document =
      route === 'pdf'
        ? await ingestPdf({ content, filename })
        : ingestText({ content, filename });
    return finishPipeline(document);
  });
}
