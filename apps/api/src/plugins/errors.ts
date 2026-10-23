import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError } from '../core/errors';

const TYPE_BASE = 'https://schoolsync.app/problems/';

/** Every error leaves the API as RFC 9457 `application/problem+json` with a stable machine `code`. */
export default fp(async (app) => {
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).type('application/problem+json').send({ type: `${TYPE_BASE}not-found`, title: 'Not Found', status: 404, code: 'ROUTE_NOT_FOUND', detail: `${req.method} ${req.url.split('?')[0]} does not exist`, requestId: req.id });
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; constraint?: string; validation?: unknown }, req, reply) => {
    const base = { requestId: req.id };
    const send = (status: number, code: string, title: string, detail?: string, extra: Record<string, unknown> = {}) =>
      reply.status(status).type('application/problem+json').send({ type: `${TYPE_BASE}${code.toLowerCase().replace(/_/g, '-')}`, title, status, code, detail, ...extra, ...base });

    if (hasZodFastifySchemaValidationErrors(err)) {
      const errors = err.validation.map((v) => ({ path: (v.instancePath || '').replace(/^\//, '').replace(/\//g, '.') || String(v.params?.issue ?? ''), message: v.message ?? 'Invalid' }));
      return send(422, 'VALIDATION_ERROR', 'Validation failed', 'One or more fields are invalid', { errors });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, 'response did not match its schema');
      return send(500, 'INTERNAL', 'Internal Server Error');
    }
    if (err instanceof AppError) return send(err.status, err.code, err.message, undefined, err.extra);
    if (err.statusCode === 429) return send(429, 'RATE_LIMITED', 'Too many requests', 'Slow down and try again shortly');
    if (err.statusCode === 413) return send(413, 'PAYLOAD_TOO_LARGE', 'Payload too large');
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) return send(err.statusCode, (err.code ?? 'BAD_REQUEST').toString(), err.message);

    // PostgreSQL. Drizzle 0.45 wraps driver errors in DrizzleQueryError, so the pg error (with `code`/`constraint`) is on `.cause`.
    const pgErr = ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
    switch (pgErr.code) {
      case '23505':
        return send(409, 'CONFLICT', 'Already exists', 'A record with the same unique value already exists', { constraint: pgErr.constraint });
      case '23503':
        return send(409, 'REFERENCE_CONFLICT', 'Related record conflict', 'The record is referenced by, or refers to, something that does not exist', { constraint: pgErr.constraint });
      case '22P02':
      case '22007':
      case '22008':
        return send(400, 'BAD_REQUEST', 'Malformed value');
      case '57014':
        return send(503, 'QUERY_TIMEOUT', 'The request took too long');
    }
    req.log.error({ err }, 'unhandled error');
    return send(500, 'INTERNAL', 'Internal Server Error');
  });
});
