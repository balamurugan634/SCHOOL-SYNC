#!/usr/bin/env bash
# Run a memory-hungry command (gradle/flutter build, vitest, tsc, next build, emulator, headless chrome, pnpm install)
# with two guarantees, so one runaway job can never freeze the whole machine:
#   1. at most HEAVY_SLOTS (default 3) such jobs run at the same time, system-wide (others queue)
#   2. each job lives in its own cgroup with a hard memory cap; if it exceeds it, ONLY that job is killed (exit 137)
#
#   scripts/dev/heavy.sh [-m 3G] [--no-slot] -- <command...>
#   scripts/dev/heavy.sh -m 5G -- flutter build apk --debug
#   scripts/dev/heavy.sh -- pnpm --filter @school-sync/api test
# -m       memory cap for this job (default 3G; gradle builds: 5G; emulator: 4G)
# --no-slot  don't take a concurrency slot (long-running servers); the memory cap still applies
set -uo pipefail
MEM=3G; SLOTS=${HEAVY_SLOTS:-3}; WAIT=${HEAVY_WAIT_SECONDS:-2400}; USE_SLOT=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m) MEM=$2; shift 2 ;;
    --no-slot) USE_SLOT=0; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[[ $# -gt 0 ]] || { sed -n '2,12p' "$0"; exit 2; }

to_mb() { case "$1" in *G|*g) echo $(( ${1%[Gg]} * 1024 ));; *M|*m) echo "${1%[Mm]}";; *) echo "$1";; esac; }
MAX_MB=$(to_mb "$MEM")

dir="${XDG_RUNTIME_DIR:-/tmp}/schoolsync-heavy"; mkdir -p "$dir"
SLOT_FD=""
if (( USE_SLOT )); then
  deadline=$(( SECONDS + WAIT )); announced=0
  while [[ -z "$SLOT_FD" ]]; do
    for i in $(seq 1 "$SLOTS"); do
      exec {fd}>"$dir/slot$i.lock"
      if flock -n "$fd"; then SLOT_FD=$fd; break; fi
      exec {fd}>&-
    done
    [[ -n "$SLOT_FD" ]] && break
    if (( SECONDS > deadline )); then echo "heavy.sh: gave up waiting for a free slot (${WAIT}s)" >&2; exit 75; fi
    if (( ! announced )); then echo "heavy.sh: all $SLOTS heavy slots busy — queued: $*" >&2; announced=1; fi
    sleep 3
  done
fi

# The child must NOT inherit the slot-lock fd (a lingering daemon, e.g. Gradle, would hold the slot forever).
# NOTE: only a hard MemoryMax — a soft MemoryHigh makes an over-limit job crawl (throttled) instead of dying.
inner='echo 500 > /proc/self/oom_score_adj 2>/dev/null; exec nice -n 10 "$@"'
run_child() {
  if command -v systemd-run >/dev/null && systemd-run --user --scope --quiet true 2>/dev/null; then
    systemd-run --user --scope --quiet --collect -p MemoryMax="${MAX_MB}M" -p MemorySwapMax=0 -- bash -c "$inner" _ "$@"
  else
    echo "heavy.sh: systemd user scopes unavailable — running WITHOUT a memory cap" >&2
    bash -c "$inner" _ "$@"
  fi
}
if [[ -n "$SLOT_FD" ]]; then eval "run_child \"\$@\" ${SLOT_FD}>&-"; else run_child "$@"; fi
rc=$?
(( rc == 137 )) && echo "heavy.sh: command was KILLED for exceeding its ${MEM} memory cap (rerun with a bigger -m, or lower its parallelism)" >&2
exit $rc
