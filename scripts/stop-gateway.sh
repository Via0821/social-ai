#!/usr/bin/env bash
# Stop the SOCIAL messaging gateway.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$PROJECT_ROOT/scripts/social-hermes" gateway stop "$@"
