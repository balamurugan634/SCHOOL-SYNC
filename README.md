# SchoolSync

Multi-tenant school ERP — **one product, deployed to many schools; each school is a "site" with its own database.**
Four role-based experiences (Student · Parent · Teacher · Management) on web and mobile.
Priced **per student per academic year** (see [docs/PRICING-AND-BILLING.md](docs/PRICING-AND-BILLING.md)).

| Part | Where | Stack |
|---|---|---|
| API | `apps/api` | Node 24, Fastify 5, Zod 4, Drizzle ORM, PostgreSQL |
| Web | `apps/web` | Next.js 16, React 19, Tailwind 4, TanStack Query |
| Shared | `packages/shared` | permission catalog, enums, zod schemas |
| Mobile | `../SCHOOL-SYNC-MOBILE` | Flutter 3.47, Riverpod, go_router, Firebase Messaging |
| Ops | `infra/` | Docker Compose, Caddy, PgBouncer, backups |

Docs: [Design system](design.md) · [Blueprint](docs/PRODUCT-BLUEPRINT.md) · [Architecture](docs/ARCHITECTURE.md) · [Backend conventions](docs/CONVENTIONS.md) · [Security](docs/SECURITY.md) · [Pricing & billing](docs/PRICING-AND-BILLING.md) · [API index](docs/API-INDEX.md) (431 operations) · [Deploying](infra/README.md) · [Mobile app](../SCHOOL-SYNC-MOBILE/README.md)

## Quick start (development)

```bash
pnpm install
cp apps/api/.env.example apps/api/.env          # first time only
pnpm dev                                        # PostgreSQL :54329 + API :4000 + web :3000, each memory-capped; Ctrl+C stops them
pnpm site:reset-demo                            # first time / to reset: creates the "demo" school (own database) + demo data
```
After a reboot just run `pnpm dev` again (it skips anything already running). `pnpm dev:stop` stops the stack by port if a terminal was closed.
Open http://demo.localhost:3000 (web) · http://localhost:4000/docs (API reference).

> **Memory safety:** `pnpm dev:web` and `pnpm dev:api` run under `scripts/dev/heavy.sh` (hard memory cap: web 5 GB, API 2 GB), so a runaway dev server is stopped on its own instead of freezing the machine. Run **one** dev server per app. Use `pnpm dev:db` for the local PostgreSQL. See `docs/CONVENTIONS.md` §13.
> **Speed check / large-school demo:** `pnpm dev:prod` builds the web app once and serves it in production mode on :3000 (run `pnpm dev:stop` for the dev web server first). It is several times faster than `pnpm dev`, which compiles on demand and runs unminified React.

Demo logins for site `demo` (password `Demo@12345`): `admin@greenvalley.edu` (super admin), `principal`, `office`, `accounts`, `hr`, `librarian`, `transport`, teachers `t001`…`t016`, student `gv20260001`, parent `9000000001`, and `9099999999` (a parent whose child link is *not yet verified* — sees nothing, by design).

## Creating a school (a "site")

```bash
pnpm site:create --code greenvalley --name "Green Valley School" --admin-email principal@gv.edu \
                 --price 150 --seats 500 --policy allow_and_bill        # per-student, per-year terms
pnpm site:migrate                 # apply schema upgrades to every school
pnpm billing usage                # seats used vs licensed per school
```
The mobile app asks for the school's site **once** on first launch, then remembers it.

## Operator console (onboarding and billing, no commands)

A web console for **us** (the platform operator, not for schools) replaces the CLI for day-to-day work: create a school, set and renew its per-student subscription, meter usage, issue invoices and mark them paid, suspend or resume a school, and read the audit log.

* Open **http://localhost:3000/platform** (on the base host, never on a school's host such as `demo.localhost`). Pages: Schools (search, filters, seats used against committed seats), Create school (school, first admin, subscription; the temporary admin password is shown **once**), School detail (overview, subscription, usage chart, invoices, settings with feature switches and suspend / resume), Billing (seats vs committed, true-up due, outstanding invoices, "Meter now"), Operators, Audit log.
* **First operator.** Set `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` (10+ characters, upper and lower case and a digit) in the API environment before the first start: when no operator exists yet, the API creates that one at startup. They must choose a new password at first sign-in; after that remove the password from the environment. Locked out, or no env access? `pnpm platform:operator --email you@company.com --password '<temporary>'` creates or resets an operator (same forced password change).
* Operators sign in with email + password (Argon2id, lockout after 5 failures, rate-limited). Access tokens are short-lived (15 min) with their own signing key and audience, so a school token is useless on `/api/v1/platform/*` and an operator token is useless on a school route. Refresh tokens rotate and are stored hashed. The browser holds only HttpOnly cookies (`ss_pat` / `ss_prt`, separate from the school cookies).
* The platform API accepts **either** an operator bearer token **or** the `X-Platform-Key` automation key (unchanged; `PLATFORM_API_KEY`). The audit log records which one acted: the operator's id, or `platform-api`.
* **Database updates need no command.** When a release adds tables or columns, the Schools list shows an "Update available" chip per school and a banner with **Update all schools**; a school's **Settings → Database** panel has **Update now**. It does what `pnpm site:migrate` does (keeps all data, safe to repeat) and records who ran it in the audit log. API: `POST /platform/tenants/migrate-all` and `POST /platform/tenants/{code}/migrate`.
* Demo data for a new school is offered only when the server is not in production (and `PLATFORM_ALLOW_DEMO_DATA` is not `false`).
* Host rule: the console answers on the base host and on `admin.<base>` / `platform.<base>`; add more with `PLATFORM_CONSOLE_HOSTS` (web env, comma separated). Everything else answers 404.
* In production keep `/api/v1/platform/*` off the public internet (the console reaches the API over the internal network): see the commented rule in `infra/Caddyfile`.

| Variable (API) | Meaning |
|---|---|
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` | bootstrap the first operator (only used while no operator exists) |
| `PLATFORM_API_KEY` | optional automation key, `X-Platform-Key` (unchanged) |
| `PLATFORM_LOGIN_RATE_LIMIT_MAX` | operator sign-in attempts per minute per client (default 10) |
| `PLATFORM_ALLOW_DEMO_DATA` | `false` hides the demo-data option even in development |
| `PLATFORM_CONSOLE_HOSTS` (web) | extra hosts that may serve the console |

Browser check of the whole console (text-only, creates and drops a school `consoletestbrowser`): `flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 1500M -- node apps/web/scripts/verify-platform.mjs`.

## Outgoing email (each school sends from its own account)

School administrators set up their own sender under **Settings → School profile and settings → Email** (needs `settings:edit`; read-only users see it disabled). Two sub-tabs, modelled on Frappe's Email Account and Email Queue:

* **Email accounts**: many per school (provider preset for Google Workspace / Microsoft 365 / Zoho / Yahoo / SendGrid / other SMTP, sender name, From and Reply-To, server, port, STARTTLS / SSL / none, username and a **write-only** password, daily limit). Send a test email, set the default, enable or disable, delete. With no enabled default the **SchoolSync default sender** (`SMTP_URL` / `MAIL_FROM`) is used, with the school's name as the sender and the school's contact email (School details) as Reply-To.
* **Email queue**: every email the school sends, with counts (Not Sent · Sending · Sent · Error · Cancelled), filters, a detail drawer (error, attempts, body preview), Send now / Retry / Cancel / Delete (one or many), Flush queue now, and Clear sent older than…. Password-reset and similar one-time messages show no body.
* **How it sends.** All mail is queued (`email_queue`); a background worker (every ~10 s, plus an immediate non-blocking kick for password resets) sends each school's queue **strictly one message at a time**, by priority then age (1 reset/OTP · 5 receipts and notifications · 9 announcements), `EMAIL_SEND_INTERVAL_MS` (default 300) apart. A failed message is retried after 1, 5 and 30 minutes, then shows as Error with a plain-language reason (never a raw server reply). A school's own server being down never blocks a password reset: that message falls back to the SchoolSync default sender. Sent mail is kept 30 days, failed or cancelled 90.
* **Safety.** SMTP hosts are resolved and refused if loopback, private, link-local, CGNAT or metadata addresses, and only ports 25 / 465 / 587 / 2525 are allowed (see docs/SECURITY.md). `ALLOW_PRIVATE_SMTP=true` lifts that for local stub servers in development and tests; the API refuses to start with it in production.
* **Upgrading existing schools.** Run `pnpm site:migrate`: migration `0001_email_accounts_queue` adds the two tables to every school database. Restart the API afterwards.
* Tests: `pnpm --filter @school-sync/api exec vitest run test/email-settings.test.ts` (uses a stub transport and a tiny in-process SMTP server, `apps/api/test/stub-smtp.ts`).

## Mobile app (Flutter, `../SCHOOL-SYNC-MOBILE`)

One app for every school: the user enters the school's site **once**, then signs in. Student, parent, teacher and management experiences.

```bash
cd ../SCHOOL-SYNC-MOBILE
scripts/dev/heavy.sh -m 5G -- scripts/build_apk.sh          # release APKs, split per ABI  → dist/
scripts/dev/heavy.sh -m 5G -- scripts/build_apk.sh debug    # debug APK for phone testing  → dist/schoolsync-debug-arm64-x64.apk
```
Phone testing: install the **debug** APK, put the phone on the same network as this machine, and in *Connect your school → Developer options* enter `http://<laptop-IP>:4000` and the site code `demo`. Release builds contain no developer options and are HTTPS-only. The README in that repo covers Firebase (push), signing, the store checklist and iOS (needs a Mac).

## Tests and checks

```bash
pnpm typecheck                              # shared + api + web
pnpm --filter @school-sync/api test         # 530+ tests; starts a throw-away PostgreSQL, one fresh school per test file
pnpm --filter @school-sync/web lint
pnpm --filter @school-sync/web smoke        # route smoke against a running dev server (status, one h1, console errors, overflow)
cd ../SCHOOL-SYNC-MOBILE && flutter analyze && flutter test --concurrency=4
```
Run heavy commands through `scripts/dev/heavy.sh` on a small machine (see the memory note above).

## Before you go live (not done for you)

| Item | Why / where |
|---|---|
| Your own Android **keystore** and `android/key.properties` | release APKs are currently signed with the debug key and cannot be uploaded to a store |
| Final **application id** (currently the placeholder `com.schoolsync.app`) | permanent once published; change it in Gradle, Xcode/Info.plist and Firebase |
| **Firebase** project: server credentials (`FIREBASE_SERVICE_ACCOUNT_JSON`) and the app's `--dart-define` values / `google-services.json` | push notifications are logged, not sent, until configured |
| **Payment gateway** keys (Razorpay adapter is written but untested against the live API) | online fee payment |
| **SMTP** (`SMTP_URL`) | password-reset and notification emails are only logged in dev |
| Object storage (S3) driver | files use local disk today; the storage interface is ready for S3 |
| Review **pricing assumptions** in `docs/PRICING-AND-BILLING.md` | no proration; withdrawn students still count; default is to bill the excess |
| TOTP/2FA for staff, Play Integrity / App Attest, a penetration test | listed in `docs/SECURITY.md` |
| Run the Docker stack once | `infra/` is written but was not run (no Docker on the dev machine) |

## Deploying

**Hetzner + GitHub Actions (push to `main` deploys automatically):** [infra/DEPLOY-HETZNER.md](infra/DEPLOY-HETZNER.md).

See [infra/](infra/) — `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build`
(Postgres + PgBouncer + Redis + API replicas + worker + web + Caddy with wildcard TLS). Details and first-school commands: [infra/README.md](infra/README.md). Docker is not installed on the dev machine, so the compose files are written but **not yet exercised**.
