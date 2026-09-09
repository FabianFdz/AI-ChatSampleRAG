export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly isOperational = true;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, AppError);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static notFound(message: string): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static internal(message: string): AppError {
    return new AppError(500, 'INTERNAL_ERROR', message);
  }
}
