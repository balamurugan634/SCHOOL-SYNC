import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load apps/api/.env if present (Node ≥ 20.12). Real environment variables always win.
for (const file of ['.env', '.env.local']) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) process.loadEnvFile(p);
}

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .transform((v) => v === 'true' || v === '1')
  .optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** public URL of this API, used when building absolute file/receipt links */
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  /** where users open the web app; `{code}` is replaced by the school's site code (links in emails, receipts) */
  PUBLIC_WEB_URL: z.string().default('http://{code}.localhost:3000'),

  // PostgreSQL cluster. Each school gets its own database on it (or on another cluster, see tenants.db_url_enc).
  PG_HOST: z.string().default('127.0.0.1'),
  PG_PORT: z.coerce.number().int().default(54329),
  PG_USER: z.string().default('postgres'),
  PG_PASSWORD: z.string().default('postgres'),
  PG_SSL: bool,
  CONTROL_DB: z.string().default('schoolsync_control'),
  TENANT_DB_PREFIX: z.string().regex(/^[a-z][a-z0-9_]*$/).default('ss_'),
  /** max PG connections held per school; keep small and put PgBouncer in front for many schools */
  TENANT_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(8),
  /** max schools with a hot pool at once (LRU) */
  TENANT_POOL_MAX_TENANTS: z.coerce.number().int().min(1).default(200),

  // Tenant resolution: <code>.<BASE_DOMAIN> or a registered custom domain or `X-Tenant: <code>`
  BASE_DOMAIN: z.string().default('localhost'),
  /** allow the X-Tenant header (mobile app + dev). Safe: tokens are tenant-bound. */
  ALLOW_TENANT_HEADER: bool.default(true),
  /** fallback school when nothing else resolves (single-school installs, local dev) */
  DEFAULT_TENANT: z.string().optional(),

  // Secrets
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  APP_ENCRYPTION_KEY: z.string().min(32, 'APP_ENCRYPTION_KEY must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  /** absolute session lifetime regardless of activity */
  SESSION_MAX_DAYS: z.coerce.number().int().default(90),
  PLATFORM_API_KEY: z.string().min(24).optional(),
  /** Operator console bootstrap: when no operator exists yet and both are set, the first one is created at startup (must change the password at first sign-in). */
  PLATFORM_ADMIN_EMAIL: z.string().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().optional(),
  /** operator sign-in attempts per minute per client address */
  PLATFORM_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  /** demo data in the console's create-school wizard: development / test only (never offered in production); `false` hides it everywhere */
  PLATFORM_ALLOW_DEMO_DATA: bool,

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY: bool.default(false),
  RATE_LIMIT_MAX: z.coerce.number().int().default(600),
  /** login/refresh/reset attempts per minute per client; keep low in production, raise for dev/tests */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(10),
  /** dev/test only: build tenant schemas with drizzle push instead of migrations (ignored in production) */
  TENANT_SCHEMA_MODE: z.enum(['migrate', 'push']).default('migrate'),
  REDIS_URL: z.string().optional(),

  // Push (FCM). Provide either JSON or a path to the service-account file. Absent → push is logged, not sent.
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  // Mail (password reset, receipts). Absent → emails are logged.
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('SchoolSync <no-reply@schoolsync.local>'),
  /** DEV/TEST ONLY: let a school's own SMTP host resolve to loopback/private ranges and use any port (a local stub server). Refused in production. */
  ALLOW_PRIVATE_SMTP: bool.default(false),
  /** pause between two queued emails of one school, in ms (the queue sends strictly one message at a time) */
  EMAIL_SEND_INTERVAL_MS: z.coerce.number().int().min(0).max(60_000).default(300),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().default(15),

  MIN_APP_VERSION: z.string().default('1.0.0'),
  /** run background workers (push dispatcher, reminders) inside the API process */
  RUN_WORKERS: bool.default(true),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}\nSee apps/api/.env.example`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    if (/change-?me|dev-?secret/i.test(cfg.JWT_SECRET) || /change-?me|dev-?secret/i.test(cfg.APP_ENCRYPTION_KEY)) {
      throw new Error('Refusing to start in production with placeholder secrets');
    }
    if (cfg.ALLOW_PRIVATE_SMTP) throw new Error('Refusing to start in production with ALLOW_PRIVATE_SMTP=true (it disables the SSRF guard for school SMTP hosts)');
  }
  return cfg;
}

export const config: Config = load();
export const isProd = config.NODE_ENV === 'production';
