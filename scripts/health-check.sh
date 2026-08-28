#!/usr/bin/env bash
# Non-destructive health check for SOCIAL. Never prints secret values.
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HERMES_HOME="$PROJECT_ROOT/.hermes"
PORT="${SOCIAL_DASHBOARD_PORT:-9119}"
rc=0

ok()   { printf '  [ OK ] %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; rc=1; }
warn() { printf '  [WARN] %s\n' "$1"; }

echo "SOCIAL health check — $(date -Is)"
echo
echo "Environment"
[[ -d "$HERMES_HOME" ]] && ok "HERMES_HOME: $HERMES_HOME" || bad "HERMES_HOME missing"
command -v hermes >/dev/null && ok "hermes on PATH ($(hermes --version 2>/dev/null | head -1))" \
                             || bad "hermes not on PATH"

echo
echo "Secrets (existence only)"
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -o allexport; source "$PROJECT_ROOT/.env" 2>/dev/null || true; set +o allexport
  for k in OPENAI_API_KEY LINE_CHANNEL_ID LINE_CHANNEL_SECRET; do
    [[ -n "${!k:-}" ]] && ok "$k configured" || bad "$k missing"
  done
  for k in LINE_CHANNEL_ACCESS_TOKEN LINE_OWNER_USER_ID; do
    [[ -n "${!k:-}" ]] && ok "$k configured" || warn "$k not yet provided"
  done
else
  bad ".env not found"
fi

echo
echo "Permissions"
for f in "$PROJECT_ROOT/.env" "$PROJECT_ROOT/.env.original" "$HERMES_HOME/.env"; do
  if [[ -f "$f" ]]; then
    label="${f#$PROJECT_ROOT/}"
    perm=$(stat -c '%a' "$f")
    [[ "$perm" == "600" ]] && ok "$label is 600" || bad "$label is $perm (want 600)"
  fi
done

echo
echo "Services"
if curl -sf -m 5 -o /dev/null "http://127.0.0.1:${PORT}/"; then
  ok "dashboard responding on 127.0.0.1:${PORT}"
else
  warn "dashboard not responding on 127.0.0.1:${PORT} (may be stopped)"
fi

if systemctl --user is-active --quiet hermes-gateway 2>/dev/null; then
  ok "gateway service active"
  [[ "$(loginctl show-user "$USER" 2>/dev/null | grep -c 'Linger=yes')" == "1" ]] \
    && ok "linger enabled (survives logout)" \
    || warn "linger disabled — gateway will stop at logout"
else
  warn "gateway service not active (LINE + cron will not run)"
fi

if ss -tln 2>/dev/null | grep -qE "0\.0\.0\.0:${PORT}|\[::\]:${PORT}"; then
  bad "dashboard is bound to a public interface — must be loopback only"
else
  ok "dashboard not publicly bound"
fi

echo
echo "Result: $([[ $rc -eq 0 ]] && echo PASS || echo FAIL)"
exit $rc
