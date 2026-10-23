#!/usr/bin/env bash
# Per-school logical backups: one compressed pg_dump per school database (+ the control DB).
# Because every school has its own database, restoring one school never touches another.
#   PGHOST=… PGUSER=… PGPASSWORD=… ./backup-tenants.sh /backups
set -euo pipefail
OUT="${1:?usage: backup-tenants.sh <dir>}"; CONTROL="${CONTROL_DB:-schoolsync_control}"
STAMP="$(date +%Y%m%d-%H%M%S)"; mkdir -p "$OUT/$STAMP"
pg_dump -Fc -d "$CONTROL" -f "$OUT/$STAMP/_control.dump"
psql -Atd "$CONTROL" -c "select db_name from tenants where status in ('active','suspended')" | while read -r db; do
  echo "dumping $db"; pg_dump -Fc -d "$db" -f "$OUT/$STAMP/$db.dump"
done
# keep 14 days
find "$OUT" -maxdepth 1 -type d -mtime +14 -name '20*' -exec rm -rf {} +
echo "done → $OUT/$STAMP"
