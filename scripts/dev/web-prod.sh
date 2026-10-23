#!/usr/bin/env bash
# The web app in production mode on :3000:  pnpm dev:prod
# `pnpm dev` runs React unminified with on-demand compiling: fine for editing, several times slower for judging speed or
# demoing a large school. This builds once (own output folder, so it never disturbs a running `pnpm dev`) and serves the result,
# under the same memory caps as everything else. Stop the dev web server first (pnpm dev:stop) — both want :3000.
cd "$(dirname "$0")/../.."
if ss -ltn 2>/dev/null | grep -q ":3000 "; then echo "Port 3000 is busy. Run 'pnpm dev:stop' (or stop whatever uses it) first."; exit 1; fi
export NEXT_DIST_DIR=.next-prod NEXT_TELEMETRY_DISABLED=1
echo "Building the web app (a minute or two)…"
flock -w 3600 /tmp/schoolsync-web-build.lock bash scripts/dev/heavy.sh -m 4500M -- pnpm --filter @school-sync/web exec next build || exit 1
echo "Serving on http://demo.localhost:3000  (API must be running: pnpm dev)"
exec bash scripts/dev/heavy.sh --no-slot -m 1500M -- env COOKIE_SECURE=false pnpm --filter @school-sync/web exec next start -p 3000
