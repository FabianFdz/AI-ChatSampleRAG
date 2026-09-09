import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/AppError.js';

interface BodyParserSyntaxError extends SyntaxError {
  status: number;
  body: unknown;
}

function isBodyParserSyntaxError(
  err: unknown,
): err is BodyParserSyntaxError {
  return (
    err instanceof SyntaxError &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    'body' in err
  );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  let statusCode: number;
  let code: string;
  let message: string;
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (isBodyParserSyntaxError(err)) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON in request body';
  } else {
    statusCode = 500;
    code = 'INTERNAL_ERROR';
    message = 'An unexpected error occurred';
  }

  const logPayload = { err, code };
  if (statusCode >= 500) {
    req.log.error(logPayload, message);
  } else {
    req.log.warn(logPayload, message);
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
      requestId: req.id,
      ...(details !== undefined && { details }),
    },
  });
}
