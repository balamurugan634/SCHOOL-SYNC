import type { Problem } from '@school-sync/shared';

/** An error response from the API (RFC 9457 problem+json), normalised for UI use. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly errors: { path: string; message: string }[];
  readonly retryAfterSeconds?: number;
  readonly requestId?: string;

  constructor(init: { status: number; code: string; title?: string; detail?: string; errors?: { path: string; message: string }[]; retryAfterSeconds?: number; requestId?: string }) {
    super(init.detail ?? init.title ?? init.code);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.errors = init.errors ?? [];
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.requestId = init.requestId;
  }

  static fromProblem(status: number, body: unknown): ApiError {
    const p = (body && typeof body === 'object' ? body : {}) as Partial<Problem> & { retryAfterSeconds?: number };
    return new ApiError({
      status,
      code: typeof p.code === 'string' ? p.code : status === 401 ? 'UNAUTHORIZED' : status >= 500 ? 'INTERNAL' : 'ERROR',
      title: p.title,
      detail: p.detail,
      errors: Array.isArray(p.errors) ? p.errors : [],
      retryAfterSeconds: typeof p.retryAfterSeconds === 'number' ? p.retryAfterSeconds : undefined,
      requestId: p.requestId,
    });
  }

  get isReadOnly() {
    return this.code === 'SUBSCRIPTION_EXPIRED';
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  /** `{ field: message }` map for react-hook-form `setError`. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.errors.map((e) => [e.path, e.message]));
  }
}

/** Human-friendly message for any thrown value. */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'INVALID_CREDENTIALS':
        return 'That username or password is not right. Check it and try again.';
      case 'ACCOUNT_DISABLED':
        return 'This account is disabled. Please contact the school office.';
      case 'STUDENT_LOGIN_DISABLED':
        return 'Student sign-in is not enabled for this school yet. Ask your parent or the school office.';
      case 'SUBSCRIPTION_EXPIRED':
        return 'This school is in read-only mode, so changes are disabled until the subscription is renewed.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'API_UNREACHABLE':
        return 'We could not reach the school server. Check your connection and try again.';
      case 'SITE_NOT_FOUND':
        return 'We could not find that school.';
      case 'SITE_SUSPENDED':
        return 'This school site is currently suspended. Please contact the school.';
    }
    return e.detail ?? e.message ?? fallback;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
