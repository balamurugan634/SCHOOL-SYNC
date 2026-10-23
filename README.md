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

Docs: [Design system](design.md) · [Blueprint](docs/PRODUCT-BLUEPRINT.md) · [Architecture](docs/ARCHITECTURE.md) · [Backend conventions](docs/CONVENTIONS.md) · [Security](docs/SECURITY.md) · [Pricing & billing](docs/PRICING-AND-BILLING.md) · [API index](docs/API-INDEX.md) (390 operations) · [Deploying](infra/README.md) · [Mobile app](../SCHOOL-SYNC-MOBILE/README.md)

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

See [infra/](infra/) — `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build`
(Postgres + PgBouncer + Redis + API replicas + worker + web + Caddy with wildcard TLS). Details and first-school commands: [infra/README.md](infra/README.md). Docker is not installed on the dev machine, so the compose files are written but **not yet exercised**.
