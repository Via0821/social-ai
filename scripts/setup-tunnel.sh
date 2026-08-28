#!/usr/bin/env bash
# Create the permanent Cloudflare named tunnel for SOCIAL.
#
#   ./scripts/setup-tunnel.sh
#
# Serves two hostnames from one tunnel:
#   social-ai01.com       → owner's UI      (127.0.0.1:9200)
#   line.social-ai01.com  → LINE webhook    (127.0.0.1:8646)
#
# The Hermes admin dashboard (9119) is deliberately NOT routed — it stays
# reachable only over SSH.
#
# Prerequisite: the domain's nameservers must already point at Cloudflare.
# Until then this script stops with instructions rather than half-configuring.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
export HERMES_HOME="$PROJECT_ROOT/.hermes"

set -o allexport; source .env; set +o allexport

DOMAIN="${SOCIAL_DOMAIN:?SOCIAL_DOMAIN is not set in .env}"
UI_HOST="${SOCIAL_UI_HOSTNAME:-$DOMAIN}"
LINE_HOST_NAME="${LINE_WEBHOOK_HOSTNAME:-line.$DOMAIN}"
UI_PORT="${SOCIAL_UI_PORT:-9200}"
LINE_PORT="${LINE_PORT:-8646}"
TUNNEL_NAME="${SOCIAL_TUNNEL_NAME:-social}"
CF_DIR="$HOME/.cloudflared"

echo "==> Checking the domain is on Cloudflare"
NS="$(dig +short NS "$DOMAIN" 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr '\n' ' ')"
if [[ "$NS" != *cloudflare* ]]; then
  cat >&2 <<MSG

STOPPING: $DOMAIN is not using Cloudflare nameservers yet.

  current: ${NS:-(none found)}

The client must do this first:
  1. Create a free Cloudflare account       https://dash.cloudflare.com/sign-up
  2. Add a site → $DOMAIN → Free plan
  3. Cloudflare shows two nameservers, e.g. xxx.ns.cloudflare.com
  4. At onamae.com, replace the current nameservers with those two
  5. Wait for Cloudflare to report the domain as "Active" (usually 1-24h)

Re-run this script once that is done. Nothing has been changed.
MSG
  exit 1
fi
echo "    OK — nameservers are on Cloudflare"

if [[ ! -f "$CF_DIR/cert.pem" ]]; then
  cat >&2 <<MSG

STOPPING: cloudflared is not authorised for this account yet.

Run this once and complete the browser step:

    cloudflared tunnel login

It prints a URL. Open it, pick $DOMAIN, and authorise. That writes
$CF_DIR/cert.pem. Then re-run this script.
MSG
  exit 1
fi

echo "==> Ensuring the tunnel exists"
if cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$TUNNEL_NAME"; then
  echo "    reusing existing tunnel '$TUNNEL_NAME'"
else
  cloudflared tunnel create "$TUNNEL_NAME"
  echo "    created"
fi

TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null \
  | awk -v n="$TUNNEL_NAME" '$2 == n {print $1}' | head -1)"
[[ -n "$TUNNEL_ID" ]] || { echo "ERROR: could not resolve the tunnel id" >&2; exit 1; }
echo "    id: $TUNNEL_ID"

echo "==> Writing the ingress config"
mkdir -p "$CF_DIR"
cat > "$CF_DIR/config.yml" <<YAML
# Managed by SOCIAL — scripts/setup-tunnel.sh
tunnel: $TUNNEL_ID
credentials-file: $CF_DIR/$TUNNEL_ID.json

ingress:
  # Owner's UI. Protected by SOCIAL_UI_PASSWORD (see docs/CUSTOM_UI.md).
  - hostname: $UI_HOST
    service: http://127.0.0.1:$UI_PORT

  # LINE webhook. Signature-verified by the adapter via LINE_CHANNEL_SECRET.
  - hostname: $LINE_HOST_NAME
    service: http://127.0.0.1:$LINE_PORT

  # The Hermes admin dashboard is intentionally absent — SSH only.
  - service: http_status:404
YAML
chmod 600 "$CF_DIR/config.yml"
echo "    $CF_DIR/config.yml"

echo "==> Pointing DNS at the tunnel"
for h in "$UI_HOST" "$LINE_HOST_NAME"; do
  cloudflared tunnel route dns "$TUNNEL_NAME" "$h" 2>&1 | sed 's/^/    /' || true
done

echo "==> Installing the tunnel as a service"
if systemctl --user list-unit-files 2>/dev/null | grep -q '^social-tunnel\.service'; then
  echo "    already installed"
else
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/social-tunnel.service" <<UNIT
[Unit]
Description=SOCIAL Cloudflare Tunnel
After=network-online.target

[Service]
ExecStart=$(command -v cloudflared) --no-autoupdate tunnel run $TUNNEL_NAME
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable social-tunnel.service
  echo "    installed and enabled"
fi

systemctl --user restart social-tunnel.service
sleep 5
systemctl --user is-active --quiet social-tunnel.service \
  && echo "    running" || echo "    WARNING: not running — journalctl --user -u social-tunnel"

cat <<MSG

────────────────────────────────────────────────────────────
  Owner's UI       https://$UI_HOST
  LINE webhook     https://$LINE_HOST_NAME/line/webhook

  Paste the webhook URL into the LINE console
  (Messaging API tab → Webhook URL → Update → Verify).
────────────────────────────────────────────────────────────

Set SOCIAL_UI_PASSWORD in .env before the UI is reachable, then:
    ./scripts/start-ui.sh
MSG
