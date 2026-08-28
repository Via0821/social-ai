#!/usr/bin/env bash
# Add or update one secret in .env, without an editor.
#
#   ./scripts/set-secret.sh LINE_CHANNEL_ACCESS_TOKEN
#
# Prompts for the value with the terminal echo off, writes it, and reports
# only the length. The value is never printed, never in your shell history,
# and never passed as an argument (which would show up in `ps`).
#
# Handles the cases that keep going wrong when editing by hand:
#   - a commented-out placeholder (# KEY=) is replaced, not duplicated
#   - surrounding quotes and stray whitespace are stripped
#   - a pasted "KEY=value" is accepted and de-duplicated
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

KEY="${1:-}"
if [[ -z "$KEY" ]]; then
  echo "usage: $0 <KEY_NAME>" >&2
  echo "e.g.:  $0 LINE_CHANNEL_ACCESS_TOKEN" >&2
  exit 2
fi
if [[ ! "$KEY" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
  echo "ERROR: key must be UPPER_SNAKE_CASE (got '$KEY')" >&2
  exit 2
fi

[[ -f "$ENV_FILE" ]] || { touch "$ENV_FILE"; chmod 600 "$ENV_FILE"; }

printf 'Paste the value for %s (input is hidden), then press Enter:\n> ' "$KEY"
IFS= read -rs VALUE
echo

[[ -n "$VALUE" ]] || { echo "ERROR: empty value — nothing written." >&2; exit 1; }

KEY="$KEY" VALUE="$VALUE" ENV_FILE="$ENV_FILE" python3 <<'PYEOF'
import os
import re
from pathlib import Path

key = os.environ["KEY"]
value = os.environ["VALUE"].strip().strip("'\"").strip()

# Tolerate a pasted "KEY=value" or "KEY: value".
m = re.match(rf"^{re.escape(key)}\s*[=:]\s*(.+)$", value)
if m:
    value = m.group(1).strip().strip("'\"").strip()

path = Path(os.environ["ENV_FILE"])
lines = path.read_text(encoding="utf-8").splitlines()

# Replace an active assignment, or an inert "# KEY=" placeholder, in place.
active = re.compile(rf"^\s*(?:export\s+)?{re.escape(key)}\s*=")
commented = re.compile(rf"^\s*#\s*(?:export\s+)?{re.escape(key)}\s*=")

out, written = [], False
for line in lines:
    if active.match(line) or commented.match(line):
        if not written:
            out.append(f"{key}={value}")
            written = True
        continue          # drop duplicates and stale placeholders
    out.append(line)

if not written:
    if out and out[-1].strip():
        out.append("")
    out.append(f"{key}={value}")

path.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8")
path.chmod(0o600)
print(f"  Wrote {key} ({len(value)} characters) to {path.name}")
PYEOF

echo
echo "Verifying it is readable as an environment variable..."
set -o allexport; source "$ENV_FILE"; set +o allexport
if [[ -n "${!KEY:-}" ]]; then
  echo "  OK — $KEY loads correctly (${#VALUE} characters)"
else
  echo "  FAILED — $KEY did not load. Check $ENV_FILE by hand." >&2
  exit 1
fi
