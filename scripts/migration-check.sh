#!/usr/bin/env bash
# Verify SOCIAL is portable to a fresh VPS: no machine-specific paths,
# no developer-owned dependencies, no secrets in tracked files.
set -uo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
rc=0
ok()   { printf '  [ OK ] %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; rc=1; }
warn() { printf '  [WARN] %s\n' "$1"; }

echo "SOCIAL migration readiness — $(date -Is)"

echo
echo "1. Hard-coded absolute paths in project files"
# Scan only git-tracked files. Untracked/ignored trees (.venv, tools/ffmpeg,
# .hermes) are vendored or generated and are not what gets migrated.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  hits=$(git ls-files -z | xargs -0 grep -In -E '/home/[a-z_][a-z0-9_-]*/' 2>/dev/null \
          | grep -vE '^(docs/|STATUS\.md|tests/acceptance\.md|CHANGELOG\.md)' || true)
else
  hits="(not a git repository — cannot scan tracked files)"
fi
if [[ -z "$hits" ]]; then ok "no hard-coded home paths in code/scripts"
else bad "hard-coded paths found:"; echo "$hits" | sed 's/^/         /' | head -10; fi

echo
echo "2. Scripts resolve PROJECT_ROOT dynamically"
for f in scripts/*.sh scripts/social-hermes; do
  [[ -f "$f" ]] || continue
  grep -q 'PROJECT_ROOT=' "$f" && ok "$(basename "$f")" || warn "$(basename "$f") has no PROJECT_ROOT"
done

echo
echo "3. Secrets are not tracked by git"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  leaked=$(git ls-files | grep -E '(^|/)\.env$|\.env\.original|credential|secret|token|\.pem$|\.key$' | grep -v '\.env\.example' || true)
  [[ -z "$leaked" ]] && ok "no secret files tracked" || { bad "tracked secret files:"; echo "$leaked" | sed 's/^/         /'; }
  git ls-files --error-unmatch .hermes >/dev/null 2>&1 && bad ".hermes/ is tracked" || ok ".hermes/ not tracked"
else
  warn "not a git repository yet"
fi

echo
echo "4. Portable artifacts present"
for f in .env.example docs/MIGRATION.md docs/HANDOFF.md config/templates/SOUL.md; do
  [[ -f "$f" ]] && ok "$f" || bad "$f missing"
done

echo
echo "5. Developer-specific runtime dependencies"
if [[ -L "$(command -v hermes 2>/dev/null)" ]]; then
  warn "hermes resolves to $(readlink -f "$(command -v hermes)") — reinstall on the production host"
fi
grep -rIn --exclude-dir=.hermes --exclude-dir=.git 'trycloudflare\.com' . >/dev/null 2>&1 \
  && warn "ephemeral tunnel URL referenced — replace with a named tunnel in production" \
  || ok "no ephemeral tunnel URLs referenced"

echo
echo "Result: $([[ $rc -eq 0 ]] && echo PASS || echo FAIL)"
exit $rc
