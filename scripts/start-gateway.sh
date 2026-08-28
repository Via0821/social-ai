#!/usr/bin/env bash
# Start the SOCIAL messaging gateway (LINE adapter + cron scheduler).
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$PROJECT_ROOT/scripts/social-hermes" gateway start "$@"
