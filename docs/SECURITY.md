# Security model

## Tenant isolation
* One PostgreSQL **database per school**; no shared tables of school data, no `tenant_id` filter to forget.
* Every request is bound to one school (Host or `X-Tenant`) *before* any handler runs; if both are present and disagree the request is refused.
* Access tokens are signed with a key **derived per school** (HKDF from the master secret) and carry the tenant id; a token from school A cannot validate at school B.
* The platform API (create schools, billing) is a separate, key-protected surface (`X-Platform-Key`), disabled unless configured — keep it on a private network.

## Authentication & sessions
* Argon2id password hashing (OWASP parameters), constant-time failure path for unknown users.
* Access JWT 15 min; **rotating opaque refresh tokens** (stored only as SHA-256), reuse of a rotated token revokes the session (replay/theft detection), absolute session lifetime 90 days, max 10 active sessions per user.
* Progressive lockout after 5 failures, per-IP/per-user rate limits on auth routes, generic error messages.
* Password reset tokens: 30 minutes, single use, hashed at rest; reset and change-password revoke other sessions.
* Role/permission changes bump `auth_version` → old access tokens are rejected (`TOKEN_STALE`) and the app refreshes.

## Authorisation
Role + Scope + Action (`packages/shared/src/permissions.ts`), enforced in the data layer (scope predicates compiled into SQL), out-of-scope records answer 404. Parent access follows only **verified** guardian links. Students/parents see only **published** results and announcements meant for them.

## Data protection
* Audit log (who/what/when/before/after) for sensitive writes; secrets auto-redacted.
* Money in integer minor units; idempotency keys on payments; payment webhooks signature-verified; client redirects are never trusted.
* Push notifications never carry private details (fees/marks/meetings/leave show a generic line); recipients are resolved server-side to authorised users only.
* Files are authorised per file (uploader, domain staff, or anyone who may see the entity referencing it), type-sniffed, size-limited, served with `nosniff` + private cache headers.
* Archival instead of deletion for students/records; per-school backups (`infra/scripts/backup-tenants.sh`).
* HTTP: Helmet headers, strict CORS (allow-list + registered domains), `Cache-Control: no-store` on API responses, request-size limits, structured problem+json errors without stack traces, log redaction of auth headers/passwords/tokens.

## Mobile app (Play Store / App Store)
HTTPS only (no cleartext in release); tokens in Keystore/Keychain-backed secure storage; optional certificate pinning (`--dart-define=PIN_SHA256`); biometric app lock; FLAG_SECURE + app-switcher privacy on sensitive screens; root/jailbreak warning; `allowBackup=false`; R8 + Dart obfuscation (`--obfuscate --split-debug-info`, archive the symbols); release signing via `key.properties` (never committed); Firebase configured by `--dart-define` so no keys live in git. See the mobile repo README for the store checklist.

## Known gaps / next steps (be explicit)
* TOTP/2FA for staff accounts.
* Play Integrity / App Attest verification of the app binary (needs your Google/Apple project).
* S3-compatible object storage driver (local disk driver ships; interface is ready).
* Redis-backed BullMQ for multi-process push fan-out (in-process queue + durable `pending` sweeper ships).
* Penetration test and dependency-audit pipeline before go-live.
