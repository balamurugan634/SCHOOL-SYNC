#!/usr/bin/env bash
# Stop the local dev stack (web :3000, API :4000, PostgreSQL :54329) by port. Use when `pnpm dev` was closed without Ctrl+C.
for port in 3000 4000 54329; do
  pid=$(ss -ltnp 2>/dev/null | grep ":$port " | sed -E 's/.*pid=([0-9]+).*/\1/' | head -1)
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null && echo "stopped :$port (pid $pid)"; else echo ":$port not running"; fi
done
