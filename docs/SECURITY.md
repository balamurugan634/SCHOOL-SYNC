# Security model

## Tenant isolation
* One PostgreSQL **database per school**; no shared tables of school data, no `tenant_id` filter to forget.
* Every request is bound to one school (Host or `X-Tenant`) *before* any handler runs; if both are present and disagree the request is refused.
* Access tokens are signed with a key **derived per school** (HKDF from the master secret) and carry the tenant id; a token from school A cannot validate at school B.
* The platform API (create schools, billing) is a separate surface, keep it on a private network. It accepts either the automation key (`X-Platform-Key`, constant-time compare, disabled unless `PLATFORM_API_KEY` is set) or the bearer token of a signed-in **platform operator**; every mutation is written to `platform_audit` with the operator id (or `platform-api`) as actor.

## Operator console (platform operators)
* Operators live in the control database (`platform_operators`), never in a school's database. Argon2id passwords, generic sign-in errors with a constant-time failure path, lockout after 5 failures (1 min, doubling, max 30), per-client rate limit (`PLATFORM_LOGIN_RATE_LIMIT_MAX`), a temporary or reset password must be changed before anything else works (403 `PASSWORD_CHANGE_REQUIRED`).
* Tokens: access JWT (15 min) with its own issuer, audience (`schoolsync-platform-console`) and signing key (HKDF label `platform-access:v1`), so it never validates on a school route, and a school token never validates on the platform API. Refresh tokens are opaque, rotate on every use, are stored only as SHA-256 (`platform_sessions`), 7 days sliding / 30 days absolute; replaying a rotated token revokes the session. Disabling an operator or changing / resetting a password signs out their sessions at once.
* Web: the console (`/platform`) is tenant-free (no school is resolved), answers 404 on a school's host, holds tokens in HttpOnly cookies named differently from the school cookies (`__Host-` prefix in production), and its BFF (`/api/platform/*`) refuses cross-site state-changing requests like the school BFF.
* One-time secrets (a new school's temporary admin password, a new operator's or reset password) are returned once by the API response and never stored in readable form or written to the audit log.
* Demo data (known password) can never be loaded from the console in production.

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

## Outgoing email (per-school accounts and queue)
A school administrator chooses the SMTP host and port, so this surface is treated as hostile input.
* **Who.** Reading needs `settings:view`, changing anything (accounts, queue actions, test sends) needs `settings:edit`, both at school scope. Every change is audited (`email_account.*`, `email_queue.*`); queue actions are one audit entry per action with the affected ids.
* **SMTP password is write-only.** AES-256-GCM, with a key derived per school by HKDF-SHA256 from `APP_ENCRYPTION_KEY` and the school id (the same construction as the per-school access-token key), a random 96-bit IV and the auth tag stored with the ciphertext (`v1.<iv>.<tag>.<ct>`), and the row id bound in as additional authenticated data, so a ciphertext copied to another row or school does not open. No API returns it (`passwordSet: true|false` only), it is not logged, and audit entries carry `credentialsSaved` instead (the audit helper also redacts `password`-like keys). `PATCH` with the field omitted keeps it, `""` removes it. Rotating `APP_ENCRYPTION_KEY` makes stored account passwords unreadable: admins must enter them again.
* **One-time messages** (password reset links) are queued `sensitive`: the body is sealed the same way, never returned by the queue API or shown in the admin screen, and erased as soon as the message is sent or cancelled.
* **SSRF guard** (`core/email/guard.ts`). Ports are limited to 25, 465, 587 and 2525. The host is resolved and **every** resulting address must be public: loopback, `0.0.0.0/8`, private (10/8, 172.16/12, 192.168/16), CGNAT 100.64/10, link-local incl. the cloud metadata address 169.254.169.254, documentation / benchmarking / reserved / multicast ranges, and the IPv6 equivalents (`::1`, `::`, fc00::/7, fe80::/10, multicast, plus IPv4-mapped, NAT64 and 6to4 forms judged by the IPv4 address they embed). It runs when settings are saved (early feedback) and again **at connect time**: the sender connects to the validated IP address and passes the host name only as TLS server name, so a DNS answer that changes between check and connect (rebinding) cannot redirect the connection. Certificates are always verified (TLS 1.2+); STARTTLS is mandatory for the STARTTLS setting (no silent downgrade). "No encryption" can only be saved with an explicit acknowledgement, which the UI shows with a plain warning.
* **`ALLOW_PRIVATE_SMTP=true`** switches the address and port checks off for local stub servers. It is for development and tests only: the API refuses to start in production with it set, and it is not set on the shared dev API.
* **Header injection.** Addresses, names, subjects and reply-to values are validated as a single plain mailbox; CR/LF and control characters are rejected (or, for subjects, replaced by a space); messages are built from structured fields, never from raw header text.
* **Errors are sanitised.** Failures reach the queue, the accounts list and the test-send answer only as one of a fixed set of plain-language sentences plus the numeric SMTP code. Raw server banners and responses (which may echo user names or parts of the authentication exchange) are never stored, returned or logged.
* **Abuse limits.** Test emails: 5 per hour per school (counted from the audit log, so it holds across API instances), one at a time, 10 s connect and greeting timeouts, 45 s ceiling per message. Recipients per message: 50. A per-account daily limit is honoured by the worker.
* **Sequential, bounded sending.** One message in flight per school is a database guarantee (partial unique index on `status = 'sending'`) on top of a per-school advisory lock taken while claiming. A claim that is not finished within 10 minutes is recovered. Each school sends at most 50 messages per worker run, so one school's backlog cannot starve the others. Sent mail is deleted after 30 days, failed or cancelled mail after 90 (`EMAIL_QUEUE_RETENTION`).
* **Fallback.** If a school's own server fails, only priority-1 mail (password reset, one-time codes) is sent through the platform default sender instead (logged as a warning, shown in the account's last send status and on the message), so nobody is locked out. Ordinary mail is not redirected: it waits and retries.

## Online meetings (Zoom / Google Meet, per-school credentials)
Each school connects its own Zoom (Server-to-Server OAuth) and/or Google Workspace (service account with domain-wide delegation) account; there is no platform-wide account. Setup and behaviour: `docs/ONLINE-MEETINGS.md`.
* **Who.** Reading needs `settings:view`, changing, testing and disconnecting need `settings:edit`, both at school scope. Every change is audited (`meeting_integration.*`) without credentials; the audit entry only says whether a secret was saved or replaced.
* **Credentials are write-only.** The Zoom client secret and the Google key file are sealed like the email passwords (AES-256-GCM, per-school HKDF key under its own purpose `meeting-secret`, random IV, the row id as additional authenticated data) and never returned, logged or audited; the screen only shows `secretSet`, the Zoom account / client id and the service account's email and Client ID. The host (start) link of a meeting is sealed the same way and only returned to callers who may edit that event or decide on that meeting.
* **Provider calls.** 10 s timeout, redirects refused, no response body is ever stored or logged; failures are reduced to a fixed set of plain sentences. The token endpoint and API hosts come from server configuration (`ZOOM_*`, `GOOGLE_*`; production requires https), never from school input: the key file's own `token_uri` is ignored.
* **Abuse limits.** Connection tests: 5 per hour per school (counted from the audit log), one at a time. Per-row lease so two workers never create two meetings for one event.
* **Privacy towards the provider.** Parent–teacher meetings send only "Parent–teacher meeting with <teacher>" and a generic agenda: never the child's name or the parent's topic.

## Mobile app (Play Store / App Store)
HTTPS only (no cleartext in release); tokens in Keystore/Keychain-backed secure storage; optional certificate pinning (`--dart-define=PIN_SHA256`); biometric app lock; FLAG_SECURE + app-switcher privacy on sensitive screens; root/jailbreak warning; `allowBackup=false`; R8 + Dart obfuscation (`--obfuscate --split-debug-info`, archive the symbols); release signing via `key.properties` (never committed); Firebase configured by `--dart-define` so no keys live in git. See the mobile repo README for the store checklist.

## Known gaps / next steps (be explicit)
* TOTP/2FA for staff accounts.
* Play Integrity / App Attest verification of the app binary (needs your Google/Apple project).
* S3-compatible object storage driver (local disk driver ships; interface is ready).
* Redis-backed BullMQ for multi-process push fan-out (in-process queue + durable `pending` sweeper ships).
* Penetration test and dependency-audit pipeline before go-live.
