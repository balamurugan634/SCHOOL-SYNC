#!/usr/bin/env bash
# Runs ON the server. GitHub Actions calls it over SSH after the images are built:
#   echo "$REGISTRY_TOKEN" | bash /opt/schoolsync/deploy-remote.sh <image-tag> <registry-prefix> <registry-user>
#   e.g.  bash deploy-remote.sh a1b2c3d4e5f6 ghcr.io/myorg myuser
# What it does, in order: take a lock, log in to the registry, pull the new images, apply database migrations (control
# database + every school) BEFORE the new version takes traffic, start the new version, wait until it is healthy and,
# if it does not become healthy, put the previous version back. Database migrations are forward-only and additive, so the
# previous version keeps working against a migrated database.
set -Eeuo pipefail
cd "$(dirname "$0")"

TAG="${1:?image tag}"
PREFIX="${2:?registry prefix, e.g. ghcr.io/owner}"
REG_USER="${3:?registry user}"
HOST="${PREFIX%%/*}"
IFS= read -r TOKEN || true
[ -n "${TOKEN:-}" ] || { echo "registry token expected on stdin"; exit 2; }
[ -f .env ] || { echo ".env is missing here: run bootstrap-server.sh first"; exit 2; }
[ -f docker-compose.yml ] || { echo "docker-compose.yml is missing here (the workflow uploads it)"; exit 2; }

exec 9>.deploy.lock
flock -n 9 || { echo "another deploy is already running"; exit 3; }

log() { printf '\n==> %s\n' "$*"; }
get_env() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
dc() { docker compose "$@"; }

PREV_TAG="$(get_env IMAGE_TAG)"
trap 'docker logout "$HOST" >/dev/null 2>&1 || true' EXIT

log "logging in to $HOST"
printf '%s' "$TOKEN" | docker login "$HOST" -u "$REG_USER" --password-stdin >/dev/null

set_env REGISTRY "$PREFIX"
set_env IMAGE_TAG "$TAG"

log "pulling images for $TAG"
dc pull --quiet api web   # worker and migrate use the api image; database images are only pulled when first needed

log "starting database services"
dc up -d postgres pgbouncer redis

log "applying database migrations (control database and every school)"
if ! dc run --rm migrate; then
  echo "::error::database migration failed: the running version has not been touched"
  set_env IMAGE_TAG "$PREV_TAG"
  exit 1
fi

log "starting the new version"
dc up -d --remove-orphans

healthy() {
  local svc id st
  for svc in api worker web; do
    local ids; ids="$(dc ps -q "$svc")"
    [ -n "$ids" ] || return 1
    for id in $ids; do
      st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
      [ "$st" = "healthy" ] || return 1
    done
  done
}

log "waiting for the new version to become healthy (up to 4 minutes)"
ok=0
for _ in $(seq 1 48); do
  if healthy; then ok=1; break; fi
  sleep 5
done

if [ "$ok" = 1 ]; then
  echo "$TAG" > .last_good_tag
  log "healthy: $TAG is live"
  docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true
  dc ps
  exit 0
fi

echo "::error::the new version did not become healthy"
dc ps || true
dc logs --tail 80 api worker web || true
if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$TAG" ]; then
  log "rolling back to $PREV_TAG"
  set_env IMAGE_TAG "$PREV_TAG"
  dc pull --quiet api web || true
  dc up -d --remove-orphans || true
else
  echo "there is no previous version to roll back to"
fi
exit 1
