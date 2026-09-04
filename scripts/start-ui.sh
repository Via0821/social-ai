#!/usr/bin/env bash
# Start the simple SOCIAL UI for the owner (loopback only).
#
# Serves the built SPA and bridges it to Hermes. The Hermes developer
# dashboard on 9119 is a separate thing and is never exposed by this.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Hermes ships its interpreter in its own venv. How `hermes` points at it
# differs by install: a symlink straight into venv/bin on some hosts, a small
# wrapper script that execs it on others. Resolve both, and fall back to
# asking hermes itself where it lives, rather than silently landing on the
# system python — which has none of the dependencies.
_resolve_hermes_python() {
  local bin candidate dir
  bin="$(command -v hermes || true)"
  [[ -n "$bin" ]] || return 1

  # (a) symlink into venv/bin
  dir="$(dirname "$(readlink -f "$bin")")"
  for candidate in "$dir/python3" "$dir/python"; do
    [[ -x "$candidate" ]] && { echo "$candidate"; return 0; }
  done

  # (b) wrapper script naming the interpreter
  candidate="$(grep -oE '/[^"]*/venv/bin/python[0-9.]*' "$bin" 2>/dev/null | head -1)"
  [[ -n "$candidate" && -x "$candidate" ]] && { echo "$candidate"; return 0; }

  # (c) ask hermes where it is installed
  dir="$("$bin" --version 2>/dev/null | sed -n 's/^Install directory:[[:space:]]*//p' | head -1)"
  for candidate in "$dir/venv/bin/python3" "$dir/venv/bin/python"; do
    [[ -x "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}
HOST="${SOCIAL_UI_HOST:-127.0.0.1}"
PORT="${SOCIAL_UI_PORT:-9200}"

# Secrets must be loaded BEFORE any check that reads them. Doing the
# password checks first made the startup banner report "Authentication:
# OFF" while the server itself had the password, and would have refused a
# public bind that was in fact configured correctly.
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +o allexport
fi

# Loopback needs no password (local development). Anything reachable from
# elsewhere must have one — including a tunnel, which forwards to loopback but
# is itself public.
if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" ]] && [[ -z "${SOCIAL_UI_PASSWORD:-}" ]]; then
  echo "REFUSING: binding to $HOST without SOCIAL_UI_PASSWORD set." >&2
  echo "Set SOCIAL_UI_PASSWORD in .env first. See docs/CUSTOM_UI.md." >&2
  exit 1
fi

if [[ -n "${SOCIAL_UI_PASSWORD:-}" ]]; then
  echo "Authentication: ON (sessions last ${SOCIAL_UI_SESSION_DAYS:-30} days)"
else
  echo "Authentication: OFF (loopback only — set SOCIAL_UI_PASSWORD to enable)"
fi

if [[ ! -d "$PROJECT_ROOT/ui/dist" ]]; then
  echo "UI not built yet. Building..."
  (cd "$PROJECT_ROOT/ui" && npm run build)
fi

export HERMES_HOME="$PROJECT_ROOT/.hermes"

# Prefer Hermes' own interpreter — it already has fastapi/uvicorn/httpx.
# Resolve it from the hermes entry point rather than hard-coding a path, so
# this works on the production host too.
if [[ -n "${SOCIAL_UI_PYTHON:-}" ]]; then
  PY="$SOCIAL_UI_PYTHON"
else
  PY="$(_resolve_hermes_python)" || PY="$(command -v python3)"
fi

if ! "$PY" -c "import fastapi, uvicorn, httpx" 2>/dev/null; then
  echo "ERROR: $PY is missing fastapi/uvicorn/httpx." >&2
  echo "Set SOCIAL_UI_PYTHON to an interpreter that has them." >&2
  exit 1
fi

echo "SOCIAL UI → http://${HOST}:${PORT}"
cd "$PROJECT_ROOT"
exec "$PY" -m uvicorn ui_server.server:app \
  --host "$HOST" --port "$PORT" --app-dir "$PROJECT_ROOT" --log-level warning
