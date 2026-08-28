#!/usr/bin/env bash
# Start the Hermes web dashboard bound to loopback only.
# Access from a workstation via SSH tunnel — never bind 0.0.0.0.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${SOCIAL_DASHBOARD_HOST:-127.0.0.1}"
PORT="${SOCIAL_DASHBOARD_PORT:-9119}"
LOG_DIR="$PROJECT_ROOT/.hermes/logs"
mkdir -p "$LOG_DIR"

if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" ]]; then
  echo "REFUSING: dashboard must stay on loopback (got '$HOST')." >&2
  echo "Use an SSH tunnel:  ssh -L ${PORT}:127.0.0.1:${PORT} <user>@<vps>" >&2
  exit 1
fi

echo "Starting SOCIAL dashboard on ${HOST}:${PORT} ..."
exec "$PROJECT_ROOT/scripts/social-hermes" dashboard \
  --host "$HOST" --port "$PORT" --no-open "$@"
