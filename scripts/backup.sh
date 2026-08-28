#!/usr/bin/env bash
# Back up SOCIAL's Hermes home (memory, sessions, skills, cron, config).
# Output contains secrets — keep it out of git and off shared storage.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HERMES_HOME="$PROJECT_ROOT/.hermes"
OUT_DIR="${1:-$PROJECT_ROOT/backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
DEST="$OUT_DIR/social-backup-$STAMP.zip"

"$PROJECT_ROOT/scripts/social-hermes" backup --output "$DEST" 2>/dev/null \
  || "$PROJECT_ROOT/scripts/social-hermes" backup

chmod 600 "$DEST" 2>/dev/null || true
echo "Backup written: $DEST"
echo "WARNING: contains secrets. Do not commit or share."
