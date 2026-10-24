import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { config, isProd } from './config';
import { tenantByDomain } from './core/tenancy/registry';
import { modules } from './modules';
import { API_VERSION } from './modules/site/routes';
import errors from './plugins/errors';
import tenantPlugin from './plugins/tenant';

export type App = FastifyInstance;

async function isAllowedOrigin(origin: string | undefined): Promise<boolean> {
  if (!origin) return true; // native apps / curl send no Origin
  if (config.CORS_ORIGINS.split(',').map((s) => s.trim()).includes(origin)) return true;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === config.BASE_DOMAIN || host.endsWith(`.${config.BASE_DOMAIN}`)) return true;
  return !!(await tenantByDomain(host));
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<App> {
  const app = Fastify({
    logger:
      opts.logger === false || config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-platform-key"]', '*.password', '*.newPassword', '*.currentPassword', '*.refreshToken'], censor: '[redacted]' },
            transport: isProd ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
          },
    genReqId: () => uuidv7(),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576,
    routerOptions: { ignoreTrailingSlash: true },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: isProd ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: isProd,
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      isAllowedOrigin(origin).then((ok) => cb(null, ok), () => cb(null, false));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Tenant', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis: config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, keyPrefix: 'ss:rl:' }) : undefined,
    // per bearer token when present (a whole school behind one NAT must not share one bucket), else per IP
    keyGenerator: (req) => `${req.headers['x-tenant'] ?? req.headers.host}:${req.headers.authorization?.slice(-24) ?? req.ip}`,
    allowList: (req) => req.url === '/api/v1/healthz',
  });
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 5, fields: 20 } });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'SchoolSync API', version: API_VERSION, description: 'Multi-tenant school ERP API. Every request is bound to a school via Host or `X-Tenant`.' },
      servers: [{ url: config.PUBLIC_API_URL }],
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, platformKey: { type: 'apiKey', in: 'header', name: 'X-Platform-Key' }, operatorToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Platform operator access token from POST /platform/auth/login' }, tenant: { type: 'apiKey', in: 'header', name: 'X-Tenant' } },
      },
      security: [{ bearer: [], tenant: [] }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(errors);
  await app.register(tenantPlugin);

  app.addHook('onSend', async (req, reply) => {
    void reply.header('X-Request-Id', req.id);
    // API responses can carry personal data: never let shared caches keep them
    if (!reply.hasHeader('Cache-Control')) void reply.header('Cache-Control', 'no-store');
  });

  await app.register(
    async (v1) => {
      for (const m of modules) await v1.register(m.plugin);
      v1.get('/openapi.json', { config: { noTenant: true }, schema: { hide: true } }, async () => app.swagger());
    },
    { prefix: '/api/v1' },
  );

  if (!isProd) {
    app.get('/docs', { config: { noTenant: true }, schema: { hide: true } }, async (_req, reply) =>
      reply.type('text/html').header('Content-Security-Policy', '').send(`<!doctype html><html><head><title>SchoolSync API</title><meta charset="utf-8"/></head><body><script id="api-reference" data-url="/api/v1/openapi.json"></script><script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.28"></script></body></html>`),
    );
  }
  return app;
}
