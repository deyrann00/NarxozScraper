#!/bin/sh
# One entry point for both scrapers and the combined report.
# Works in the Docker image (/app) and in a checkout of this repo (cron, manual runs).
#
#   narxoz all [--email] [--hours N]   2GIS + Threads + combined report (default)
#   narxoz report [--email] [--hours N] [--no-overview]
#   narxoz 2gis <command>              e.g. run, analyze --force, email
#   narxoz threads <command>           e.g. scrape, analyze --force
#   narxoz login                       save a Threads session (headed browser on a virtual display)
#   narxoz mcp-2gis                    2GIS MCP server on stdio (for Claude)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f /app/2gis/server/index.js ]; then
  TWOGIS="/app/2gis/server/index.js"
  THREADS_DIR="/app/threads"
else
  TWOGIS="$ROOT/2gis/plugins/claude/server/index.js"
  THREADS_DIR="$ROOT/threads"
  # cron starts with a bare PATH; add the usual Node / Python locations.
  PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
  if [ -f "$ROOT/.env" ]; then
    set -a
    . "$ROOT/.env"
    set +a
  fi
fi
NODE="${NODE:-node}"
# A checkout usually has the Threads package in threads/.venv.
if [ -z "${PYTHON:-}" ]; then
  if [ -x "$THREADS_DIR/.venv/bin/python" ]; then PYTHON="$THREADS_DIR/.venv/bin/python"; else PYTHON="python3"; fi
fi

# First run with an empty data volume: start from the bundled configs so they can be edited.
seed() {
  if [ -n "${2:-}" ] && [ -f "$1" ] && [ ! -f "$2/config.json" ]; then
    mkdir -p "$2" && cp "$1" "$2/config.json"
  fi
}
seed "$(dirname "$TWOGIS")/../config.json" "${NARXOZ_2GIS_ROOT:-}"
seed "$THREADS_DIR/config.json" "${NARXOZ_SCRAPER_ROOT:-}"

twogis() { "$NODE" "$TWOGIS" "$@"; }
threads() { (cd "$THREADS_DIR" && "$PYTHON" -m socnetscraper "$@"); }
stamp() { echo "=== $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }

command="${1:-all}"
[ $# -gt 0 ] && shift

case "$command" in
  all)
    status=0
    stamp "2gis run"
    twogis run || status=1
    stamp "threads scrape"
    threads scrape || status=1
    stamp "report $*"
    twogis report "$@" || status=1
    stamp "exit $status"
    exit $status
    ;;
  report) twogis report "$@" ;;
  2gis) twogis "$@" ;;
  threads) threads "$@" ;;
  login) cd "$THREADS_DIR" && exec xvfb-run "$PYTHON" -m socnetscraper login ;;
  mcp-2gis) exec "$NODE" "$TWOGIS" ;;
  help | -h | --help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//' ;;
  *)
    echo "Unknown command: $command (try: narxoz help)" >&2
    exit 1
    ;;
esac
