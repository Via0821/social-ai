# Changelog

## 2026-08-22 — Phases 0–9

### Environment
- Audited the development VPS (Ubuntu 20.04.6, 5 vCPU, 14 GiB, 218 GB).
- Found Hermes Agent v0.20.4 already installed at `~/.hermes/hermes-agent`
  (git, Python 3.11.16). Not reinstalled; source unmodified.
- Left the pre-existing `~/.hermes/profiles/social-dev` profile untouched.

### Project
- Created the project structure, `.gitignore`, `.env.example`, docs and tests.
- Added `scripts/social-hermes`, which pins
  `HERMES_HOME=~/Social-ai/.hermes` so SOCIAL never touches the developer's
  personal Hermes profile.
- Added `start-dashboard.sh`, `start-gateway.sh`, `stop-gateway.sh`,
  `health-check.sh`, `backup.sh`, `migration-check.sh`.

### Credentials
- The client's `.env` was free-form prose with no parseable `KEY=VALUE`
  pairs. Normalized via `tests/scripts/normalize_env.py`, which classifies
  values by shape and asserts each guess against a strict pattern — no secret
  was ever displayed. Original preserved as `.env.original` (600, gitignored).
- Recovered: `OPENAI_API_KEY`, `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`,
  `GOOGLE_ACCOUNT_EMAIL`.
- The Gmail password was deliberately excluded from the working `.env`
  (OAuth2-only policy, spec §15).

### Hermes / OpenAI
- Ran `config migrate` (v0 → v38).
- Set `model.default=gpt-5.2`, `model.provider=openai-api`.
  `provider` (top level) and the value `openai` are both wrong — the working
  key is `model.provider` and the registry name is `openai-api`.
- Validated the OpenAI key against the live API.
- Added `VOICE_TOOLS_OPENAI_KEY` for the upcoming STT/TTS phase.

### SOCIAL
- Wrote `.hermes/SOUL.md` (Japanese): personality, fact/inference/memory
  separation, two-layer memory policy, credential refusal, LINE formatting,
  voice reply style. Based on the earlier `social-dev` draft.
- Installed the official `finance/stocks` skill (Yahoo Finance, read-only).

### Verified
CORE-01, CORE-02, JP-01, JP-02, UI-01, MEM-01, MEM-02, MEM-03, WEB-01,
WEB-02, SEC-02, SEC-03 — all end-to-end, not by inspection.
