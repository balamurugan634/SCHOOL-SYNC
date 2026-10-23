#!/usr/bin/env bash
# Dev memory guard (earlyoom-style, user space, no root). Watches free memory and kernel memory-pressure (PSI).
# Before the desktop starts thrashing it SIGKILLs the single biggest *dev tool* process (Gradle/Kotlin daemons,
# emulator, vitest, tsc, next, embedded Postgres, headless Chrome...). It never touches VS Code, Claude, the browser,
# or anything not on the allow-list below.
#
#   scripts/dev/guard.sh                 run in the foreground
#   GUARD_DRY_RUN=1 scripts/dev/guard.sh log what it would kill, kill nothing
# Tunables: GUARD_MIN_AVAIL_MB (1200)  GUARD_PSI (40)  GUARD_INTERVAL (2)
MIN_AVAIL_MB=${GUARD_MIN_AVAIL_MB:-1200}
PSI_MAX=${GUARD_PSI:-40}
INTERVAL=${GUARD_INTERVAL:-2}
DRY=${GUARD_DRY_RUN:-0}
LOG="${XDG_STATE_HOME:-$HOME/.local/state}/schoolsync-guard.log"; mkdir -p "$(dirname "$LOG")"
ALLOW='GradleDaemon|GradleWrapperMain|gradle-launcher|KotlinCompileDaemon|kotlin-compiler|qemu-system|/emulator/|vitest|next-server|next dev|next build|turbopack|embedded-postgres|\.data/postgres|--headless|flutter_tools|frontend_server|dartaotruntime|esbuild|/tsc( |$)|tsx '
NEVER='claude|/usr/share/code|gnome-|Xwayland|guard\.sh|systemd|sshd|dbus'
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }
log "guard started (min_avail=${MIN_AVAIL_MB}MB psi>${PSI_MAX} dry=$DRY)"
while sleep "$INTERVAL"; do
  avail=$(awk '/^MemAvailable:/{printf "%d",$2/1024}' /proc/meminfo)
  psi=$(awk '/^some/{split($2,a,"="); printf "%d",a[2]}' /proc/pressure/memory 2>/dev/null || echo 0)
  if (( avail < MIN_AVAIL_MB )) || { (( psi > PSI_MAX )) && (( avail < 3000 )); }; then
    # list by RSS; drop our own helper commands (their args contain the allow-list text) before matching
    victim=$(ps -u "$USER" -o pid=,rss=,comm=,args= --sort=-rss | awk '$3!="grep" && $3!="ps" && $3!="awk" && $3!="sed" && $3!="bash" || $4 ~ /heavy\.sh/ {print}' | awk '$3!="grep" && $3!="ps" && $3!="awk" && $3!="sed"' | grep -E "$ALLOW" | grep -vE "$NEVER" | head -1 | awk '{pid=$1; rss=$2; $1=$2=$3=""; print pid, rss, substr($0,4)}')
    if [[ -z "$victim" ]]; then log "LOW MEMORY avail=${avail}MB psi=${psi} but no allow-listed dev process to stop"; sleep 10; continue; fi
    read -r pid rss args <<<"$victim"
    log "LOW MEMORY avail=${avail}MB psi=${psi} -> $([[ $DRY == 1 ]] && echo 'WOULD kill' || echo 'killing') pid=$pid rss=$((rss/1024))MB: ${args:0:140}"
    [[ $DRY == 1 ]] || kill -9 "$pid" 2>/dev/null
    sleep 5
  fi
done
