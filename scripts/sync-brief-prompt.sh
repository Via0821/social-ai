#!/usr/bin/env bash
# Push config/daily-brief-prompt.txt into the cron job.
#
# The job stores its OWN COPY of the prompt, taken when it was created.
# Editing the file alone changes nothing about what runs — a fix to the
# prompt silently never reaches the schedule. Run this after every edit.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
export HERMES_HOME="$PROJECT_ROOT/.hermes"

PROMPT_FILE="$PROJECT_ROOT/config/daily-brief-prompt.txt"
JOB_NAME="${SOCIAL_BRIEF_JOB:-social-daily-brief}"

[[ -f "$PROMPT_FILE" ]] || { echo "ERROR: $PROMPT_FILE not found" >&2; exit 1; }

JOB_ID="$(python3 - "$JOB_NAME" <<'PY'
import json, sys
from pathlib import Path
import os
name = sys.argv[1]
data = json.loads(Path(os.environ["HERMES_HOME"], "cron", "jobs.json").read_text())
jobs = data if isinstance(data, list) else data.get("jobs", [])
print(next((j["id"] for j in jobs if j.get("name") == name), ""))
PY
)"
[[ -n "$JOB_ID" ]] || { echo "ERROR: no cron job named '$JOB_NAME'" >&2; exit 1; }

echo "==> Updating $JOB_NAME ($JOB_ID)"
./scripts/social-hermes cron edit "$JOB_ID" --prompt "$(cat "$PROMPT_FILE")" >/dev/null

# Confirm from the store rather than trusting the command's exit code.
python3 - "$JOB_ID" "$PROMPT_FILE" <<'PY'
import json, os, sys
from pathlib import Path
job_id, prompt_file = sys.argv[1], Path(sys.argv[2])
want = prompt_file.read_text(encoding="utf-8").strip()
data = json.loads(Path(os.environ["HERMES_HOME"], "cron", "jobs.json").read_text())
jobs = data if isinstance(data, list) else data.get("jobs", [])
job = next(j for j in jobs if j["id"] == job_id)
got = (job.get("prompt") or "").strip()
if got == want:
    print(f"    in sync ({len(got)} chars)")
else:
    print(f"    MISMATCH — file {len(want)} chars, job {len(got)} chars", file=sys.stderr)
    raise SystemExit(1)
PY
