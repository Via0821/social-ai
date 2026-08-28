#!/usr/bin/env bash
# Bring LINE online end to end.
#
#   ./scripts/setup-line.sh              # start tunnel, print the webhook URL
#   ./scripts/setup-line.sh --watch      # ...then watch for the owner's userId
#
# Requires LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET in .env.
# The LINE adapter auto-enables from those two alone (see the plugin's
# _env_enablement) — no config.yaml block is needed.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
export HERMES_HOME="$PROJECT_ROOT/.hermes"

LINE_PORT="${LINE_PORT:-8646}"
WEBHOOK_PATH="/line/webhook"
TUNNEL_LOG="$HERMES_HOME/logs/cloudflared.log"
mkdir -p "$HERMES_HOME/logs"

set -o allexport; source .env; set +o allexport

if [[ -z "${LINE_CHANNEL_ACCESS_TOKEN:-}" ]]; then
  cat >&2 <<'MSG'
ERROR: LINE_CHANNEL_ACCESS_TOKEN is not set in .env

Add it as a KEY=VALUE line (no quotes, no spaces around =):

    LINE_CHANNEL_ACCESS_TOKEN=<the long-lived token>

Then re-run this script. Nothing else is needed to enable LINE.
MSG
  exit 1
fi

echo "==> Syncing secrets into .hermes/.env"
./scripts/sync-env.sh >/dev/null
echo "    done"

echo "==> Restarting the gateway so it picks up the LINE adapter"
./scripts/social-hermes gateway restart >/dev/null 2>&1 || true
sleep 6

if ss -tln 2>/dev/null | grep -q ":${LINE_PORT}"; then
  echo "    adapter listening on ${LINE_PORT}"
else
  echo "    WARNING: nothing listening on ${LINE_PORT} yet." >&2
  echo "    Check: journalctl --user -u hermes-gateway -n 40" >&2
fi

# A named tunnel gives a stable hostname but needs the domain on a Cloudflare
# account. LINE_PUBLIC_URL may already name the eventual hostname before DNS
# exists, so only trust it when it actually resolves — otherwise we would hand
# LINE a URL that cannot answer.
USE_CONFIGURED=0
if [[ -n "${LINE_PUBLIC_URL:-}" && "${1:-}" != "--temp" ]]; then
  # Resolving is not enough: a registrar parking wildcard answers for every
  # subdomain, so the name resolves while nothing reaches this host. Probe the
  # adapter's own health path and require it to actually answer.
  if curl -sf -m 10 -o /dev/null "${LINE_PUBLIC_URL}${WEBHOOK_PATH}/health" 2>/dev/null; then
    USE_CONFIGURED=1
  else
    echo "==> $LINE_PUBLIC_URL does not reach this server yet"
    echo "    (it may resolve to a parking page). Using a temporary tunnel."
  fi
fi

if [[ "$USE_CONFIGURED" == "1" ]]; then
  echo "==> Using the configured LINE_PUBLIC_URL"
  PUBLIC_URL="$LINE_PUBLIC_URL"
else
  echo "==> Starting a Cloudflare quick tunnel (temporary hostname)"
  pkill -f "cloudflared tunnel --url http://127.0.0.1:${LINE_PORT}" 2>/dev/null || true
  : > "$TUNNEL_LOG"
  setsid cloudflared tunnel --url "http://127.0.0.1:${LINE_PORT}" \
    > "$TUNNEL_LOG" 2>&1 < /dev/null &

  PUBLIC_URL=""
  for _ in $(seq 1 40); do
    sleep 1
    PUBLIC_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    [[ -n "$PUBLIC_URL" ]] && break
  done

  if [[ -z "$PUBLIC_URL" ]]; then
    echo "ERROR: the tunnel did not report a hostname. See $TUNNEL_LOG" >&2
    exit 1
  fi
fi

WEBHOOK_URL="${PUBLIC_URL}${WEBHOOK_PATH}"

echo "==> Local health check"
curl -s -m 5 "http://127.0.0.1:${LINE_PORT}${WEBHOOK_PATH}/health" >/dev/null \
  && echo "    adapter responding" \
  || echo "    WARNING: adapter did not answer on ${LINE_PORT}"

# The access token can set the endpoint directly, so nobody has to paste a URL
# into the console — which also removes the chance of a typo.
echo "==> Registering the webhook with LINE"
REG=$(curl -s -m 30 -X PUT https://api.line.me/v2/bot/channel/webhook/endpoint \
  -H "Authorization: Bearer ${LINE_CHANNEL_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"endpoint\":\"${WEBHOOK_URL}\"}")
if [[ "$REG" == "{}" ]]; then
  echo "    registered: ${WEBHOOK_URL}"
else
  echo "    LINE said: $REG" >&2
fi

echo "==> Asking LINE to test the endpoint"
TEST=$(curl -s -m 30 -X POST https://api.line.me/v2/bot/channel/webhook/test \
  -H "Authorization: Bearer ${LINE_CHANNEL_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" -d "{}")
echo "    $TEST"

echo
echo "────────────────────────────────────────────────────────────"
echo "  Webhook is live:"
echo "      ${WEBHOOK_URL}"
echo "────────────────────────────────────────────────────────────"
echo

if [[ "$USE_CONFIGURED" != "1" ]]; then
  echo "NOTE: temporary hostname — it changes if this tunnel restarts."
  echo "      Run ./scripts/setup-tunnel.sh for the permanent address once"
  echo "      the domain is on Cloudflare."
  echo
fi

if [[ "${1:-}" == "--watch" ]]; then
  echo
  echo "==> Watching for the owner's LINE userId."
  echo "    Send any message to the bot from the owner's phone now."
  echo "    (Ctrl+C to stop.)"
  echo
  exec "$PROJECT_ROOT/scripts/find-line-user.sh"
fi
