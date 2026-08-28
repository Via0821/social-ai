#!/usr/bin/env bash
# Capture the owner's LINE userId from the first inbound webhook event.
#
# The LINE Developers console does not always show "Your user ID", so this
# reads it from the first message the owner sends to the bot instead.
#
#   ./scripts/find-line-user.sh
#
# Prints the userId and the exact lines to add to .env. Writes nothing itself.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HERMES_HOME="$PROJECT_ROOT/.hermes"
TIMEOUT="${1:-300}"

echo "Waiting up to ${TIMEOUT}s for a message from the owner's LINE account..."
echo

# Inbound userIds are U + 32 hex. Read the gateway journal live.
USER_ID="$(
  timeout "$TIMEOUT" journalctl --user -u hermes-gateway -f -n 200 --output=cat 2>/dev/null \
    | grep -m1 -oE 'U[0-9a-f]{32}' || true
)"

if [[ -z "$USER_ID" ]]; then
  cat >&2 <<'MSG'
No userId seen.

Check, in order:
  1. Is the webhook URL set in the LINE console, with "Use webhook" ON?
  2. Did Verify succeed?
  3. Is the tunnel still up?   ./scripts/setup-line.sh
  4. Gateway logs:            journalctl --user -u hermes-gateway -n 60
MSG
  exit 1
fi

cat <<MSG

Found the owner's LINE userId:

    ${USER_ID}

Add this to .env, then re-run sync:

    LINE_OWNER_USER_ID=${USER_ID}

    ./scripts/sync-env.sh
    ./scripts/social-hermes gateway restart

sync-env.sh derives both values the adapter needs from it:
  LINE_ALLOWED_USERS  — locks the bot to this one person
  LINE_HOME_CHANNEL   — where the Daily Brief is pushed
MSG
