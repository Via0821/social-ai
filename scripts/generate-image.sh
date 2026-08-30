#!/usr/bin/env bash
# Generate an image from a prompt and print the file path.
#
#   ./scripts/generate-image.sh "青い猫のイラスト"
#
# Uses the owner's own OpenAI account (gpt-image-*). Hermes' built-in image
# tool routes through fal.ai and needs FAL_KEY — a second paid vendor for a
# capability the owner already pays for.
#
# Prints only the path, so the caller can hand it straight to a MEDIA: tag.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HERMES_HOME="$PROJECT_ROOT/.hermes"

PROMPT="${1:-}"
[[ -n "$PROMPT" ]] || { echo "usage: $0 \"<prompt>\"" >&2; exit 2; }

set -o allexport
# shellcheck disable=SC1091
source "$PROJECT_ROOT/.env"
set +o allexport
[[ -n "${OPENAI_API_KEY:-}" ]] || { echo "OPENAI_API_KEY is not set" >&2; exit 1; }

OUT_DIR="$HERMES_HOME/generated"
mkdir -p "$OUT_DIR"

PY="$(dirname "$(readlink -f "$(command -v hermes)")")/python3"
[[ -x "$PY" ]] || PY="$(command -v python3)"

PROMPT="$PROMPT" OUT_DIR="$OUT_DIR" \
  MODEL="${SOCIAL_IMAGE_MODEL:-gpt-image-1}" "$PY" <<'PYEOF'
import base64, json, os, secrets, sys, time, urllib.request

req = urllib.request.Request(
    "https://api.openai.com/v1/images/generations",
    data=json.dumps({
        "model": os.environ["MODEL"],
        "prompt": os.environ["PROMPT"],
        "size": "1024x1024",
        "n": 1,
    }).encode(),
    headers={
        "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
        "Content-Type": "application/json",
    },
)
try:
    with urllib.request.urlopen(req, timeout=300) as resp:
        item = (json.load(resp).get("data") or [{}])[0]
except Exception as exc:                      # noqa: BLE001
    print(f"image generation failed: {exc}", file=sys.stderr)
    raise SystemExit(1)

dest = os.path.join(
    os.environ["OUT_DIR"], f"{int(time.time())}_{secrets.token_hex(6)}.png"
)
if item.get("b64_json"):
    with open(dest, "wb") as fh:
        fh.write(base64.b64decode(item["b64_json"]))
elif item.get("url"):
    with urllib.request.urlopen(item["url"], timeout=120) as img:
        with open(dest, "wb") as fh:
            fh.write(img.read())
else:
    print("no image data returned", file=sys.stderr)
    raise SystemExit(1)

print(dest)
PYEOF
