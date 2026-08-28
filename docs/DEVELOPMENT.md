# SOCIAL — Development

## Host (development VPS, audited 2026-08-22)

| | |
|---|---|
| OS | Ubuntu 20.04.6 LTS (Focal), kernel 5.4.0-216 |
| CPU / RAM / Disk | 5 vCPU AMD EPYC-Milan · 14 GiB · 218 GB (5% used) |
| User | `dev` (in `sudo`, but sudo requires a password) |
| System Python | 3.8.10 — **not used by SOCIAL** |
| Hermes Python | 3.11.16 (bundled venv) |
| Git / curl / Node | 2.25.1 · 7.68.0 · v26.7.0 |
| systemd | 245 · user lingering **disabled** |
| Also installed | `cloudflared` (for the LINE webhook tunnel) |

**Note on Python.** The spec requires Python 3.11+. The system Python is
3.8.10, but Hermes ships its own 3.11.16 venv at
`~/.hermes/hermes-agent/venv`, and there is a 3.11 interpreter at
`~/.local/bin/python3.11`. Custom skills and plugins run under Hermes'
3.11 venv, so the 3.11+ requirement is satisfied without touching the
system interpreter. Do not `apt install` a different system Python — it
risks other applications on this host.

## Hermes installation

Already present when this project began — **not installed by SOCIAL**:

| | |
|---|---|
| Version | Hermes Agent v0.20.4 (2026.8.18), upstream `443d4387` |
| Install dir | `~/.hermes/hermes-agent` |
| Method | git |
| Entry points | `~/.local/bin/hermes`, `~/.local/bin/hermes-gateway` |

The Hermes *installation* is shared and lives in `~/.hermes`. SOCIAL's
*state* is entirely separate, under `~/Social-ai/.hermes`. Hermes source is
never modified.

## Pre-existing state left untouched

`~/.hermes/profiles/social-dev` is an earlier exploratory profile from a
previous session. It is **not used** and has been left exactly as found, per
the instruction not to modify existing Hermes state. Its `SOUL.md` draft was
a useful starting point and its wording was carried forward into
`config/templates/SOUL.md`.

## Project layout

```
~/Social-ai/
├── .env                  secrets, chmod 600, gitignored
├── .env.original         client's original paste, chmod 600, gitignored
├── .env.example          template, committed
├── .hermes/              HERMES_HOME — all SOCIAL runtime state, gitignored
│   ├── .env  config.yaml  SOUL.md
│   ├── memories/  sessions/  skills/  logs/  cron/
├── config/templates/     committed copies of SOUL.md / config / env
├── extensions/           custom skills + plugins (only if Hermes lacks a feature)
├── scripts/              operational bash
├── tests/                acceptance criteria + helper scripts
└── docs/
```

## Auto-downloaded ffmpeg

The first voice transcription caused Hermes to download a static ffmpeg
(~200 MB) into `tools/ffmpeg-7.0.2-amd64-static/` inside the project. It is
a platform-specific binary, so it is gitignored rather than committed.

On the production VPS either let it download again on first use, or install
the system package ahead of time:

```bash
sudo apt-get install -y ffmpeg
```

Installing it system-wide is preferable — it avoids the 200 MB download and
keeps the project directory to source only.

## Working rules

- Always use `./scripts/social-hermes`, never bare `hermes`.
- Never print a secret. Use `tests/scripts/inspect_env.py` for safe inspection.
- Prefer Hermes' built-in capability over custom code (see spec §45).
- Bash scripts: `set -euo pipefail`, resolve `PROJECT_ROOT`, quote variables.
- Python: 3.11+ syntax, type hints, no hard-coded credentials.

## Rebuilding this environment from scratch

```bash
git clone <repo> Social-ai && cd Social-ai
cp .env.example .env && chmod 600 .env   # then fill in real values
# install Hermes Agent per upstream Linux instructions
./scripts/social-hermes config set model.default gpt-5.2
./scripts/social-hermes config set model.provider openai-api
cp config/templates/SOUL.md .hermes/SOUL.md
./scripts/health-check.sh
```
