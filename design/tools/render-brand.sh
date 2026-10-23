#!/usr/bin/env bash
# Renders the brand PNGs with headless Chrome (one at a time, through heavy.sh).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
prof="${TMPDIR:-/tmp}/schoolsync-brand-chrome"
shot() { # name W H transparent(0/1)
  local extra=(); [[ "$4" == 1 ]] && extra+=(--default-background-color=00000000)
  "$root/scripts/dev/heavy.sh" -m 1500M -- google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --user-data-dir="$prof" --force-device-scale-factor=1 "${extra[@]}" --window-size="$2,$3" \
    --screenshot="$here/../brand/$1.png" "file://$here/.wrap/$1.html" >/dev/null 2>&1
}
node "$here/build-brand.mjs"
shot app-icon-1024 1024 1024 0
shot adaptive-foreground-432 432 432 1
shot adaptive-background 432 432 0
shot adaptive-monochrome-432 432 432 1
shot favicon-32 32 32 1
