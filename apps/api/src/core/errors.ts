/** Typed application errors → RFC 9457 problem+json (see plugins/errors.ts). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', extra?: Record<string, unknown>) => new AppError(400, code, message, extra);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') => new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to do that', code = 'FORBIDDEN') => new AppError(403, code, message);
/** Also used when the record exists but the caller may not see it — never reveal existence. */
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const unprocessable = (message: string, code = 'UNPROCESSABLE') => new AppError(422, code, message);
export const tooMany = (message = 'Too many attempts, try again later', code = 'RATE_LIMITED') => new AppError(429, code, message);
