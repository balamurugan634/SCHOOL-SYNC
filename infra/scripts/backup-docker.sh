#!/usr/bin/env bash
# Nightly backup on the server: one compressed pg_dump per school database plus the control database, taken inside the
# running Postgres container. Restoring one school never touches another. Run by cron (see bootstrap-server.sh).
#   /opt/schoolsync/backup-docker.sh [/opt/schoolsync/backups]      KEEP_DAYS=14 by default
set -Eeuo pipefail
cd "$(dirname "$0")"
OUT="${1:-/opt/schoolsync/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
envval() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
PGU="$(envval PG_USER)"; PGU="${PGU:-postgres}"
CONTROL="$(envval CONTROL_DB)"; CONTROL="${CONTROL:-schoolsync_control}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT/$STAMP"
pg() { docker compose exec -T postgres "$@"; }

pg pg_dump -Fc -U "$PGU" -d "$CONTROL" > "$OUT/$STAMP/_control.dump"
pg psql -U "$PGU" -Atd "$CONTROL" -c "select db_name from tenants where status in ('active','suspended')" | while read -r db; do
  [ -n "$db" ] || continue
  echo "dumping $db"
  pg pg_dump -Fc -U "$PGU" -d "$db" > "$OUT/$STAMP/$db.dump"
done
find "$OUT" -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "done: $OUT/$STAMP"
