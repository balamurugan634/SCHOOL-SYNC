# Deploy SchoolSync to a Hetzner server with GitHub Actions

Every push to `main` is tested, built into two Docker images, and deployed to your server automatically.

```
git push main ─▶ checks (typecheck · lint · tests · builds)
              ─▶ build + push images to GitHub Container Registry (api, web; tagged with the commit)
              ─▶ SSH to the server ─▶ upload release files
              ─▶ database migrations (control DB + every school) BEFORE traffic moves
              ─▶ start the new version ─▶ wait until healthy ─▶ live check on https://your-domain
              └─ not healthy? the previous version is put back and the run fails
```

Files: `.github/workflows/ci.yml` and `deploy.yml`, `infra/docker-compose.prod.yml`, `infra/Caddyfile`,
`infra/scripts/bootstrap-server.sh` (one-time server setup), `deploy-remote.sh` (runs on every deploy), `backup-docker.sh` (nightly).

## What you need

* A domain you control (examples below use `schoolsync.example.com`). Schools live at `https://<code>.schoolsync.example.com`.
* Your Hetzner Cloud server with **Ubuntu 24.04 or Debian 12** and an SSH key you can log in with. **4 GB RAM is the practical minimum**
  (CX22 or CAX11 can start a pilot with one API container; 8 GB, e.g. CX32, for real use).
* **Server type matters for one setting:** a normal Intel/AMD server (CX, CPX, CCX) needs nothing. An ARM server (CAX) needs the GitHub
  variable `DEPLOY_PLATFORM=linux/arm64` (below), otherwise the images will not run.
* The repository on GitHub (it is `balamurugan634/SCHOOL-SYNC`; `origin` is already set).

## One-time setup

### 1. DNS
At your DNS provider create two records pointing to the server's public IP (add `AAAA` records too if you use IPv6):

| Type | Name | Value |
|---|---|---|
| A | `schoolsync.example.com` (or `@` if the domain is dedicated to SchoolSync) | server IPv4 |
| A | `*.schoolsync.example.com` (or `*`) | server IPv4 |

The wildcard covers every school (`greenvalley.…`) and the operator console host. HTTPS certificates are issued automatically
the first time each address is opened, and only for addresses of schools that really exist.

### 2. A key for GitHub to deploy with (on your own computer)
```bash
ssh-keygen -t ed25519 -f ~/.ssh/schoolsync_deploy -C github-actions-deploy -N ""
```
This creates a private key (`schoolsync_deploy`, goes into GitHub) and a public key (`schoolsync_deploy.pub`, goes on the server).

### 3. Prepare the server (once)
From the project folder on your computer:
```bash
scp infra/scripts/bootstrap-server.sh root@SERVER_IP:/root/
ssh root@SERVER_IP "bash /root/bootstrap-server.sh \
    --domain schoolsync.example.com \
    --email you@example.com \
    --deploy-key \"$(cat ~/.ssh/schoolsync_deploy.pub)\""
```
It installs Docker, creates the `deploy` user, writes `/opt/schoolsync/.env` with **randomly generated secrets**, opens only ports
22/80/443, turns on fail2ban and automatic security updates, adds swap on small servers and schedules a nightly backup.
**Copy the operator password it prints at the end** (it is also in `/opt/schoolsync/.env`). Safe to run again; it never overwrites `.env`.

Optional, once your own SSH key works: re-run with `--harden-ssh` to disable password logins.

### 4. GitHub settings
Repository → **Settings → Secrets and variables → Actions**.

**Secrets**

| Name | Value |
|---|---|
| `DEPLOY_HOST` | the server's IPv4 address |
| `DEPLOY_SSH_KEY` | the whole content of `~/.ssh/schoolsync_deploy` (the private key, including the BEGIN/END lines) |
| `DEPLOY_KNOWN_HOSTS` | the output of `ssh-keyscan -t ed25519 SERVER_IP` (this pins the server, so nobody can impersonate it) |
| `DEPLOY_USER` | optional, default `deploy` |

**Variables**

| Name | Value |
|---|---|
| `BASE_DOMAIN` | `schoolsync.example.com` (compiled into the web app, so it must match the DNS and the server's `.env`) |
| `DEPLOY_PLATFORM` | optional: `linux/arm64` for an ARM (CAX) server; default `linux/amd64` |

Optional: **Settings → Environments → New environment → `production`**, tick *Required reviewers* if you want a manual approval before
each deploy (the `deploy` job waits for it).

### 5. Push
```bash
cd /home/bala/SCHOOL-SYNC
git status                       # check the list: .env files and build output are git-ignored, source and infra/ are not
git add -A
git commit -m "Add deployment pipeline"
git push origin main
```
Open the repository's **Actions** tab and watch *Deploy to Hetzner*. The first run is the slowest (it builds both images from scratch,
about 10 to 20 minutes); later runs reuse the build cache. When it turns green, open `https://schoolsync.example.com/platform`.

### 6. First sign-in and first school
* Console: `https://schoolsync.example.com/platform`, email from step 3, the printed temporary password. You must choose a new password.
  Afterwards **delete the `PLATFORM_ADMIN_PASSWORD` line** from `/opt/schoolsync/.env` (`ssh deploy@SERVER_IP`, `nano /opt/schoolsync/.env`).
* In the console: **Create school**. Its address is `https://<code>.schoolsync.example.com`. Nothing needs a command line.

## Sharing a server that already runs other apps (a reverse proxy owns ports 80/443)

Use this when another app is already on the server and its own proxy (for example a Caddy container) serves ports 80 and 443. Do **not**
run the normal setup there: it would fight for those ports and turn on a firewall. In **shared mode** SchoolSync is only added:
no ports are published, no firewall, SSH, swap or package changes, memory limits per container, and your existing proxy forwards
the school addresses to it.

```
browser ─▶ existing proxy (owns 80/443, e.g. sols-caddy) ─┬─ lahab.sols-ai.com … ─▶ your existing apps (their own blocks win)
                                                          └─ greenvalley.sols-ai.com, admin.sols-ai.com … ─▶ SchoolSync
```

**Before anything: list what the base domain is already used for.** Every name an existing app uses must keep its own entry; and no
school may be created with such a name (it could never be reached).
```bash
docker exec sols-caddy cat /etc/caddy/Caddyfile        # the hosts it serves (use your proxy container's name)
```
Put those names (just the first label: `lahab`, `resto`, …) into `RESERVED_SITE_CODES_EXTRA` in `/opt/schoolsync/.env` after step 3, then `schoolsync up -d`.

1. **DNS:** keep every existing record. Add one wildcard `A` record `*.sols-ai.com` (your base domain) to the server's IP. Names that
   already have their own record keep working because an exact record beats the wildcard. If a wildcard record already points elsewhere, stop and tell me.
2. **Find the proxy's Docker network:**
   `docker inspect sols-caddy --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'`
3. **Prepare SchoolSync (shared mode):** the same `scp` as in the normal step 3, then
   ```bash
   ssh root@SERVER_IP "bash /root/bootstrap-server.sh --shared --edge-network NETWORK_NAME \
       --domain sols-ai.com --email you@example.com \
       --deploy-key \"$(cat ~/.ssh/schoolsync_deploy.pub)\""
   ```
4. **Teach the existing proxy about SchoolSync** (two small additions; **back up its Caddyfile first**): copy the two blocks from
   `infra/caddy/existing-caddy.snippet` into the proxy's Caddyfile (the first goes into the existing global options block at the top,
   there can be only one), then check and reload:
   ```bash
   docker exec sols-caddy caddy validate --config /etc/caddy/Caddyfile
   docker exec sols-caddy caddy reload   --config /etc/caddy/Caddyfile
   ```
   The new `*.sols-ai.com` block only receives names that have no block of their own, and a certificate is issued for a name only if
   SchoolSync confirms it is a real school.
5. **GitHub:** the same secrets as before (`DEPLOY_HOST` is this server), and the variables `BASE_DOMAIN=sols-ai.com` plus
   **`HEALTHCHECK_HOST=admin.sols-ai.com`**: the base domain itself belongs to your other app, so the pipeline's live check opens the console host instead.
6. **Push.** The operator console is then at `https://admin.sols-ai.com/platform`; each school at `https://<code>.sols-ai.com`.

Memory is the thing to watch on a shared server. SchoolSync's containers have ceilings (`API_MEM`, `WEB_MEM`, `PG_MEM`, `REDIS_MEM` in
`.env`; small by default) so they cannot take the server down, but a 4 GB server shared with other apps is a pilot size. Check with
`docker stats --no-stream` and `free -m`. When schools grow, move SchoolSync to its own server: the same pipeline works unchanged
(use the normal setup there), and the schools' databases come across with `backup-docker.sh` and `pg_restore`.

## Day to day

Log in to the server (`ssh deploy@SERVER_IP`) and use the `schoolsync` shortcut (it is `docker compose` for the stack):

| Task | Command |
|---|---|
| What is running | `schoolsync ps` |
| Follow logs | `schoolsync logs -f api` (or `web`, `worker`, `caddy`) |
| Restart one service | `schoolsync restart web` |
| Change settings | edit `/opt/schoolsync/.env`, then `schoolsync up -d` |
| Roll back by hand | set `IMAGE_TAG=<older commit tag>` in `.env`, then `schoolsync up -d`. Or in GitHub: Actions → an older successful run → *Re-run all jobs* |
| Backups | nightly 02:30 into `/opt/schoolsync/backups` (14 days). Run now: `/opt/schoolsync/backup-docker.sh` |
| Restore one school | `cat backups/<stamp>/<db>.dump \| schoolsync exec -T postgres pg_restore -U postgres -d <db> --clean --if-exists` |
| Stop deploying on push | delete the `push:` trigger in `deploy.yml`; *Run workflow* (manual) still works |

Where to look when something is wrong: the failing step in the Actions run (the deploy script prints the container logs when the new
version is unhealthy), then `schoolsync logs --tail 100 api` on the server.

## Safe by design, and where you must still care

* **Secrets never enter GitHub** except the SSH key: the server's `.env` is created on the server. The registry login uses the run's
  own temporary token, sent over SSH standard input.
* **Migrations are forward-only** and run before traffic moves. If the new version then fails its health check the previous version is
  restored, but the database stays migrated. Keep migrations additive (new tables/columns) so the previous version still works.
* **Only 22, 80 and 443 are open.** Postgres, PgBouncer and Redis are not published. The operator API (`/api/v1/platform/*`) and the
  certificate check are blocked on the public address; the console reaches them inside the Docker network.
* **Backups stay on the same server.** Copy `/opt/schoolsync/backups` off it (Hetzner Storage Box with `rsync`, or enable Hetzner server
  backups/snapshots). A backup on the machine that dies is not a backup.
* **Rotating `APP_ENCRYPTION_KEY`** makes stored school email passwords unreadable (schools re-enter them). Do not rotate it casually.
* **Many schools at once:** Let's Encrypt allows 50 new certificates per week per domain. For bulk onboarding use one wildcard
  certificate (see the comment in `infra/Caddyfile`; needs a Caddy build with your DNS provider's plugin).
* **Zero downtime is not promised.** Containers are replaced during a deploy, so expect a few seconds of errors. Strict zero downtime
  needs two servers behind a load balancer, which this single-server setup does not do.
* **The mobile app is not part of this pipeline.** It lives in `SCHOOL-SYNC-MOBILE` and is built and published separately.

## What was tested, and what was not

Tested here: the API's new HTTPS check (5 tests), the full API suite, the workflow and compose files parse as YAML, the server scripts
(syntax, argument validation, `.env` generation in a sandbox), `pnpm deploy` for the API image, and the **production API bundle** run
from the deployed layout with `NODE_ENV=production` (migrations on a fresh control database, boot, health check, creating a school with
the bundled CLI so both migrations apply, and the certificate check including the "arrived through the proxy from the internet" case).

**Not tested, in the shared-server mode in particular:** the Caddy blocks in `infra/Caddyfile` and `infra/caddy/existing-caddy.snippet` were written
from Caddy's documentation but never run through `caddy validate` (no Caddy binary was available here), and the shared overlay (`docker-compose.shared.yml`) is only
checked as valid YAML. **Always run `caddy validate` on your proxy before reloading it**; a failed validation changes nothing.

**Not tested: building the Docker images and running the compose stack.** Docker is not installed on the development machine, and GitHub
Actions has not run this pipeline yet. The first run can reveal a problem in a Dockerfile or in the compose file; the Actions log shows
it, and `ci.yml` builds both images on every pull request so such problems are found before they reach `main`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| *Set the repository variable BASE_DOMAIN* | variable missing (step 4) |
| *Missing GitHub secret DEPLOY_…* | a secret is missing or empty |
| `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` does not match the server (re-run `ssh-keyscan`; did the server get rebuilt?) |
| `Permission denied (publickey)` | `DEPLOY_SSH_KEY` is not the key whose `.pub` you gave the bootstrap script |
| `exec format error` in a container | ARM server with an amd64 image: set `DEPLOY_PLATFORM=linux/arm64` |
| *database migration failed* | read the lines above it; the running version was not touched |
| Run is green but the site shows a certificate error | DNS has not reached the server yet; wait a few minutes; `schoolsync logs caddy` shows the certificate attempts |
| Password-reset emails link to the wrong address or are not sent | `PUBLIC_WEB_URL` / `SMTP_URL` in `/opt/schoolsync/.env`; schools can also add their own sender under Settings → Email |
