#!/bin/sh
# Cron entry point: loads .env, runs one collection pass and appends to logs/cron-YYYY-MM.log.
# Arguments are passed through, e.g. `scripts/cron.sh run --email --hours 24`.
# Default command: `run`.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

# cron starts with a bare PATH; add the usual Node locations (Homebrew, /usr/local).
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
NODE="${NODE:-$(command -v node)}"

if [ -f "$ROOT/.env" ]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

mkdir -p "$ROOT/logs"
LOG="$ROOT/logs/cron-$(date +%Y-%m).log"
LOCK="$ROOT/logs/cron.lock"

# Skip this run if the previous one is still going.
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') skipped: previous run still in progress ($LOCK)" >> "$LOG"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT INT TERM

if [ -z "$NODE" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') node not found; set NODE=/path/to/node in the crontab" >> "$LOG"
  exit 1
fi

[ $# -eq 0 ] && set -- run
echo "=== $(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
"$NODE" "$ROOT/plugins/claude/server/index.js" "$@" >> "$LOG" 2>&1
status=$?
echo "=== exit $status" >> "$LOG"
exit $status
