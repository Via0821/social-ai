#!/usr/bin/env bash
# Install the owner's UI as a systemd user service.
#
# The gateway and the tunnel are supervised; the UI was not, so when it died
# it stayed dead and the site went down silently. This puts it under the same
# supervision: Restart=always, starts at boot, one command to manage.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/social-ui.service"

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

PY="$(_resolve_hermes_python)" || PY="$(command -v python3)"
if ! "$PY" -c "import fastapi, uvicorn, httpx" 2>/dev/null; then
  echo "ERROR: $PY is missing fastapi/uvicorn/httpx." >&2
  echo "Set SOCIAL_UI_PYTHON to an interpreter that has them." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<UNITEOF
[Unit]
Description=SOCIAL owner UI
After=network-online.target

[Service]
WorkingDirectory=$PROJECT_ROOT
EnvironmentFile=$PROJECT_ROOT/.env
Environment="HERMES_HOME=$PROJECT_ROOT/.hermes"
# systemd starts services with a minimal PATH that excludes ~/.local/bin,
# where the hermes launcher lives. Without this the adapter starts fine but
# every turn that reaches Hermes dies with "hermes: not found" — and the
# voice fast path still works, which makes the failure look selective.
Environment="PATH=$(dirname "$PY"):$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=$PY -m uvicorn ui_server.server:app --host 127.0.0.1 --port 9200 --app-dir $PROJECT_ROOT --log-level warning
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNITEOF

systemctl --user daemon-reload
systemctl --user enable social-ui.service >/dev/null
systemctl --user restart social-ui.service
sleep 4

if systemctl --user is-active --quiet social-ui.service; then
  echo "social-ui: running (enabled at boot, restarts on failure)"
else
  echo "social-ui: FAILED — journalctl --user -u social-ui -n 30" >&2
  exit 1
fi
