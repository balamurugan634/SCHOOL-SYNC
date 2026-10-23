#!/usr/bin/env bash
# One command for local development:  pnpm dev
# Starts PostgreSQL (:54329), the API (:4000) and the web app (:3000), each under a hard memory cap
# (scripts/dev/heavy.sh), skipping any that are already running. Ctrl+C stops only what this script started.
cd "$(dirname "$0")/../.."
H=scripts/dev/heavy.sh
LOGDIR="${TMPDIR:-/tmp}/schoolsync-dev"; mkdir -p "$LOGDIR"
pgids=()
up() { ss -ltn 2>/dev/null | grep -q ":$1 "; }
# Each service runs in its own SESSION (setsid). Children (pnpm, node, postgres) end up in different process *groups*
# inside that session, so we stop them by session id, not by group.
stop_session() { local sid=$1; pkill -TERM -s "$sid" 2>/dev/null; for _ in 1 2 3 4 5 6 7 8; do pgrep -s "$sid" >/dev/null 2>&1 || return 0; sleep 1; done; pkill -KILL -s "$sid" 2>/dev/null; }
cleanup() { trap - INT TERM EXIT; echo; echo "stopping what this script started…"; for g in "${pgids[@]}"; do stop_session "$g"; done; exit 0; }
trap cleanup INT TERM EXIT
start() { # name port cap command...
  local name=$1 port=$2 cap=$3; shift 3
  if up "$port"; then echo "  ✓ $name already running on :$port"; return; fi
  echo "  … starting $name (memory cap $cap)"
  local pidfile="$LOGDIR/$name.pid"; rm -f "$pidfile"
  # own session + process group (pgid = the recorded pid) so Ctrl+C can stop the whole tree; setsid may fork, so the pid is written from inside
  setsid bash -c 'echo $$ > "$1"; shift; exec bash "$@"' _ "$pidfile" "$H" --no-slot -m "$cap" -- "$@" > "$LOGDIR/$name.log" 2>&1 < /dev/null &
  for _ in $(seq 1 20); do [ -s "$pidfile" ] && break; sleep 0.2; done
  [ -s "$pidfile" ] && pgids+=("$(cat "$pidfile")")
  for _ in $(seq 1 60); do up "$port" && { echo "  ✓ $name ready on :$port   (log: $LOGDIR/$name.log)"; return; }; sleep 1; done
  echo "  ✗ $name did not come up in 60 s — see $LOGDIR/$name.log"
}
echo "SchoolSync dev stack"
start postgres 54329 1G   pnpm --filter @school-sync/api dev:db
start api      4000  2G   env NODE_OPTIONS=--max-old-space-size=1024 pnpm --filter @school-sync/api dev
start web      3000  5G   env NODE_OPTIONS=--max-old-space-size=3584 NEXT_TELEMETRY_DISABLED=1 pnpm --filter @school-sync/web dev
echo
echo "  Web:  http://demo.localhost:3000     API docs: http://localhost:4000/docs"
echo "  Demo logins (password Demo@12345): admin@greenvalley.edu · principal · office · accounts · t001 · gv20260001 · 9000000001"
echo "  First time or after a data reset:  pnpm site:reset-demo"
[ ${#pgids[@]} -eq 0 ] && exit 0
echo "  Ctrl+C stops what was started here."
# stay attached until Ctrl+C / SIGTERM (the EXIT trap then stops the services this script started)
while true; do sleep 3600 & wait $!; done
