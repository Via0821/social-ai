#!/usr/bin/env bash
# Fetch market data for the Daily Brief, with retries.
#
#   ./scripts/fetch-market.sh [SYMBOL ...]
#
# Yahoo rate-limits bursts around 08:00 JST, which cost the brief its market
# section three days running. Two things matter here:
#
#   * ONE invocation for all symbols. The skill paces its own requests
#     internally; separate calls per symbol are what triggers the 429.
#   * Retries INSIDE this script. The obvious fix — "sleep 60; python ..." —
#     is a compound command, which cron cannot run: it needs approval and no
#     user is present. A single script sidesteps that entirely.
#
# Prints the skill's JSON on success. On repeated failure prints nothing and
# exits non-zero, so the caller says the data was unavailable rather than
# inventing numbers.
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HERMES_HOME="$PROJECT_ROOT/.hermes"

SCRIPT="$HERMES_HOME/skills/finance/stocks/scripts/stocks_client.py"
[[ -f "$SCRIPT" ]] || { echo "stocks skill not installed" >&2; exit 1; }

PY="$(dirname "$(readlink -f "$(command -v hermes)")")/python3"
[[ -x "$PY" ]] || PY="$(command -v python3)"

if [[ $# -gt 0 ]]; then
  SYMBOLS=("$@")
else
  SYMBOLS=('^GSPC' '^IXIC' '^N225' 'NVDA' 'AAPL' 'MSFT')
fi

ATTEMPTS="${SOCIAL_MARKET_ATTEMPTS:-3}"
BACKOFF="${SOCIAL_MARKET_BACKOFF:-45}"

for attempt in $(seq 1 "$ATTEMPTS"); do
  OUT="$("$PY" "$SCRIPT" quote "${SYMBOLS[@]}" 2>/dev/null)"
  # A usable result is JSON containing at least one price.
  if [[ -n "$OUT" ]] && printf '%s' "$OUT" | grep -q '"price"'; then
    printf '%s\n' "$OUT"
    exit 0
  fi
  if [[ "$attempt" -lt "$ATTEMPTS" ]]; then
    echo "attempt ${attempt}/${ATTEMPTS} failed (likely HTTP 429); waiting ${BACKOFF}s" >&2
    sleep "$BACKOFF"
  fi
done

echo "market data unavailable after ${ATTEMPTS} attempts" >&2
exit 1
