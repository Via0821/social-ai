#!/usr/bin/env bash
# Propagate secrets from the project .env into .hermes/.env, which Hermes
# and the systemd gateway service read directly.
#
# Run after adding or changing any credential in .env.
# Never prints a value — only which keys were synced.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$PROJECT_ROOT/.env"
DST="$PROJECT_ROOT/.hermes/.env"

[[ -f "$SRC" ]] || { echo "ERROR: $SRC not found" >&2; exit 1; }

python3 - "$SRC" "$DST" <<'PYEOF'
import re, sys
from pathlib import Path

src, dst = Path(sys.argv[1]), Path(sys.argv[2])

# Keys Hermes itself consumes. GOOGLE_ACCOUNT_EMAIL is intentionally omitted:
# it is a reference value for the OAuth setup, not a Hermes runtime input.
WANTED = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "LINE_CHANNEL_ID",
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_ALLOWED_USERS",
    "LINE_HOME_CHANNEL",
    "LINE_PUBLIC_URL",
    "LINE_PORT",
    "LINE_HOST",
    "LINE_SLOW_RESPONSE_THRESHOLD",
    "TAVILY_API_KEY",
    "GITHUB_TOKEN",
    "VOICE_TOOLS_OPENAI_KEY",
]

vals = dict(re.findall(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$",
                       src.read_text(encoding="utf-8"), re.M))

# LINE_OWNER_USER_ID is SOCIAL's name for the owner; the adapter reads
# LINE_ALLOWED_USERS and LINE_HOME_CHANNEL. Derive both when it is set.
owner = vals.get("LINE_OWNER_USER_ID", "").strip()
if owner:
    vals.setdefault("LINE_ALLOWED_USERS", owner)
    vals.setdefault("LINE_HOME_CHANNEL", owner)

# Keep the webhook on loopback; the tunnel fronts it.
vals.setdefault("LINE_HOST", "127.0.0.1")

# Voice STT/TTS uses the same OpenAI key under a separate variable name.
if vals.get("OPENAI_API_KEY", "").strip():
    vals.setdefault("VOICE_TOOLS_OPENAI_KEY", vals["OPENAI_API_KEY"])

out = ["# Managed by scripts/sync-env.sh — generated from ../.env.",
       "# Do not edit by hand; your changes will be overwritten.", ""]
synced = []
for k in WANTED:
    v = vals.get(k, "").strip().strip("'\"")
    if v:
        out.append(f"{k}={v}")
        synced.append(k)

dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text("\n".join(out) + "\n", encoding="utf-8")
dst.chmod(0o600)

print(f"Synced {len(synced)} key(s) to .hermes/{dst.name} (chmod 600):")
for k in synced:
    print(f"  {k}")
missing = [k for k in ("LINE_CHANNEL_ACCESS_TOKEN", "LINE_OWNER_USER_ID")
           if not vals.get(k, "").strip()]
if missing:
    print("\nStill missing (LINE phase):")
    for k in missing:
        print(f"  {k}")
print("\nNo secret values were printed.")
PYEOF

echo
echo "Restart the gateway to pick up changes:  ./scripts/social-hermes gateway restart"
