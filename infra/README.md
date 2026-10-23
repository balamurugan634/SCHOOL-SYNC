# Deploying SchoolSync

`docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build` (copy `infra/.env.example` to `infra/.env` first).

| Service | Role |
|---|---|
| `postgres` + `pgbouncer` | one cluster, **one database per school**; the API opens small per-school pools through PgBouncer (transaction mode; `IGNORE_STARTUP_PARAMETERS=options`) |
| `redis` | rate limiting (shared across API replicas) |
| `api` (×2) | stateless Fastify API — scale horizontally; `RUN_WORKERS=false` |
| `worker` (×1) | push sweeper, usage metering, reminders, scheduled publishing (jobs are advisory-locked, so two workers would not double-run) |
| `migrate` | one-shot `site-migrate`: applies schema migrations to every school before the new version takes traffic |
| `web` | Next.js (standalone output); resolves the school from the host |
| `caddy` | TLS (Let's Encrypt) and wildcard routing `*.BASE_DOMAIN` → web/api. A wildcard certificate needs the DNS challenge plugin for your DNS provider (see `Caddyfile`) |

## First school
```bash
docker compose -f infra/docker-compose.yml run --rm api node dist/cli/site-create.js \
  --code greenvalley --name "Green Valley School" --admin-email principal@gv.edu --price 150 --seats 500
```
Schools are reachable at `https://greenvalley.<BASE_DOMAIN>`; the mobile app asks for that site once.

## Operations
* **Backups:** `infra/scripts/backup-tenants.sh <dir>` — one `pg_dump` per school database + the control DB; restoring one school never touches another.
* **Upgrades:** build new images → `migrate` runs against all schools → roll the API replicas → web.
* **Billing:** `node dist/cli/billing.js usage|snapshot|invoice` (per-student, per-academic-year; see `docs/PRICING-AND-BILLING.md`).
* **Secrets:** `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `PLATFORM_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, SMTP, payment-gateway keys live only in `infra/.env` / your secret manager — never in git. The API refuses to start in production with placeholder secrets.
* **Platform API** (`/api/v1/platform/*`) is disabled unless `PLATFORM_API_KEY` is set; keep it off the public internet (VPN / separate listener).

> These files have **not been exercised** — Docker is not installed on the development machine. The API bundle (`pnpm --filter @school-sync/api build`) and its CLIs were run directly with `NODE_ENV=production` and work; the Next.js standalone build is verified to produce `apps/web/server.js`. Expect to tune PgBouncer pool sizes and Caddy's TLS setup on first deploy.
