# SchoolSync — Architecture

## Repositories / folders

| Path | What |
|---|---|
| `/home/bala/SCHOOL-SYNC` | Web app + API monorepo (pnpm workspaces) |
| `apps/api` | Fastify 5 + TypeScript REST API (multi-tenant) |
| `apps/web` | Next.js 16 (App Router) web app, role-based dashboards |
| `packages/shared` | Permission catalog, role presets, enums, zod schemas shared by API + web |
| `infra/` | Docker Compose, Dockerfiles, reverse proxy config |
| `/home/bala/SCHOOL-SYNC-MOBILE` | Flutter app (Android + iOS), one binary for all schools |

## Multi-tenancy: one site = one school = one database

```
                       ┌─────────────────────┐
  school-a.example.com │  API (stateless xN)  │──► control DB  (tenants, domains, platform admins)
  school-b.example.com │  resolves tenant per │──► ss_school_a (all of school A's data)
  mobile: site URL     │  request, pools DBs  │──► ss_school_b (all of school B's data)
                       └─────────────────────┘
```

* **Control DB** `schoolsync_control`: `tenants` (code, name, db name, status, branding, plan), `tenant_domains`, `subscriptions`, `usage_snapshots`, `billing_invoices`, `platform_audit`, and the operator console's `platform_operators` + `platform_sessions` (platform operators are separate from every school's users). Operators run the web console at `/platform` (docs/SECURITY.md); the same `/api/v1/platform/*` API also accepts the `X-Platform-Key` automation key.
* **Tenant DB** `ss_<code>`: every school table. No `tenant_id` columns — isolation is physical. A bug can't leak across schools.
* **Resolution order** per request: `X-Tenant` header (site code; used by the mobile app and dev) → `Host` header (custom domain from `tenant_domains`, or `<code>.<BASE_DOMAIN>`).
* **Pools**: LRU of `pg.Pool` per tenant (bounded), idle eviction. Put PgBouncer (transaction mode) between API and Postgres in production.
* **Provisioning**: `pnpm site:create` → `CREATE DATABASE`, run migrations, seed system roles/permissions/grade-scale/periods/settings, create first super-admin. Schema upgrades: `pnpm site:migrate` (all tenants, advisory-locked, resumable).
* **Tokens are tenant-bound**: access JWT signed with a key derived (HKDF) from the master secret + tenant id, and carries `tid`; a token from school A is rejected by school B twice over.

## Mobile "site" concept

The user enters the school's **site** (URL like `https://greenvalley.schoolsync.app`, or just the code) **once** on first launch. The app calls the public `GET /api/v1/site/info`, verifies the school, stores the site in secure storage, applies the school's branding and then shows login. "Change school" is available from settings (logs out + wipes tokens).

## Auth & sessions

* Login identifier: username / email / phone / admission no. / employee id + password (Argon2id).
* Access token: JWT (15 min). Refresh token: opaque, 256-bit, **rotating**, stored hashed; replaying a rotated token revokes the session (reuse detection).
* Sessions are per device, listable and revocable; account lockout with progressive delay; rate limits on auth routes.
* Web: Next.js BFF keeps tokens in `HttpOnly; Secure; SameSite=Lax` cookies (JS never sees them). Mobile: Keystore/Keychain via secure storage, optional biometric app lock.

## Authorisation: Role + Scope + Action

* Permission key = `resource:action` (catalog in `packages/shared/src/permissions.ts`).
* A role grants `permission → scope` (`own < linked < assigned < school`). User with several roles gets the **widest** scope per permission.
* Scope is resolved to SQL predicates (`core/rbac/scope.ts`): which students/sections the caller may touch. Every query on protected data goes through them — the check is in the data layer, not only in route guards.
* `linked` only follows **verified** guardian links. `assigned` = sections where the teacher is class teacher or has a teaching assignment.
* Sensitive actions (publish results, approve corrections/refunds, change permissions) require explicit permission and write an audit record.

## Data & scale

* PostgreSQL 17/18, Drizzle ORM, UUIDv7 primary keys (time-ordered → index-friendly), money as integer minor units, soft-archive instead of delete.
* High-volume tables (`attendance_records`, `audit_logs`, `notifications`) have composite/covering indexes for their hot queries and are designed so they can be range-partitioned later without API changes.
* Keyset pagination on large lists; list endpoints cap page size.
* API is stateless → scale horizontally. Redis (optional in dev, recommended in prod) backs rate limiting and the notification queue.
* Push notifications: persisted in `notifications` first (inbox), then fanned out to FCM in batches by a worker; failures retry, dead tokens are pruned.
* Outgoing email: nothing talks SMTP inside a request. `enqueueMail(tenant, …)` (core/email) writes a row to the school's `email_queue`; a worker (`email.send`, the scheduler's 10-second tick in `core/jobs.ts`, plus an immediate non-blocking kick for priority-1 mail such as password resets) sends each school's queue **one message at a time** (priority, then age) through the school's default `email_accounts` row, or the platform sender (`SMTP_URL` / `MAIL_FROM`) when the school has none. Retries after 1, 5, 30 minutes; stuck `sending` rows recovered after 10 minutes; per-account daily limit; at most 50 messages per school per run; retention job 30 / 90 days. Schools are visited round-robin, a few at a time. Past a few thousand schools replace the per-tick "anything due?" probe with a shared signal (Redis).

## Mobile security (store-ready)

HTTPS-only (Android network security config, iOS ATS), no cleartext in release, optional SPKI certificate pinning (`--dart-define`), tokens in secure storage, biometric/PIN app lock, screen-capture protection + app-switcher blur on sensitive screens, root/jailbreak signal, `allowBackup=false`, R8 minify + Dart obfuscation (`--obfuscate --split-debug-info`), release signing via `key.properties` (never committed), Firebase configured by `--dart-define` so no secrets are in git.

## Tech stack (versions as of Oct 2026)

Node 24 · TypeScript · Fastify 5 · Zod 4 · Drizzle ORM 0.45 + node-postgres · PostgreSQL 17/18 · Redis 6+/7 · firebase-admin · Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query 5 · Flutter 3.47 / Dart 3.13 · Riverpod · go_router · Dio · Firebase Messaging.
