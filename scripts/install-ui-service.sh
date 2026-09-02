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

# Resolve Hermes' interpreter from its entry point rather than hard-coding a
# path, so this stays correct on the production host.
PY="$(dirname "$(readlink -f "$(command -v hermes)")")/python3"
[[ -x "$PY" ]] || PY="$(command -v python3)"

mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<UNITEOF
[Unit]
Description=SOCIAL owner UI
After=network-online.target

[Service]
WorkingDirectory=$PROJECT_ROOT
EnvironmentFile=$PROJECT_ROOT/.env
Environment="HERMES_HOME=$PROJECT_ROOT/.hermes"
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
