export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'PAYMENT_FAILED'
  | 'INTERNAL_ERROR';

export interface AppError {
  code: ErrorCode;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function createError(
  code: ErrorCode,
  message: string,
  statusCode: number,
  details?: Record<string, unknown>
): AppError {
  return { code, message, statusCode, details };
}

export function handleError(err: unknown): AppError {
  if (isAppError(err)) return err;

  if (err instanceof Error) {
    return createError('INTERNAL_ERROR', err.message, 500);
  }

  return createError('INTERNAL_ERROR', 'An unexpected error occurred', 500);
}

export function isAppError(err: unknown): err is AppError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'statusCode' in err
  );
}

export function toErrorResponse(err: AppError): ErrorResponse {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}
