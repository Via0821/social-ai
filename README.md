# SOCIAL

A private, single-user personal AI assistant built on
[Hermes Agent](https://github.com/NousResearch/hermes-agent).

SOCIAL speaks Japanese by default, remembers its owner, works from both LINE
and a PC browser, understands voice, searches current information, reads
markets and Google Sheets, and delivers a scheduled daily brief.

It is not a chatbot product, not multi-user, and not a SaaS. Hermes is the
runtime; SOCIAL is the configuration, personality and skill set on top of it.

## Status

Phases 0–9 complete: environment audit, project setup, Hermes on a
project-local home, OpenAI, SOCIAL identity, Japanese CLI, localhost
dashboard, memory, web search, markets.

LINE, voice, Google Sheets and the scheduled brief are pending client-side
credentials — see **Human Action Required** in [STATUS.md](STATUS.md).

## Quickstart

```bash
cd ~/Social-ai
./scripts/health-check.sh                          # verify the environment
./scripts/social-hermes -z "あなたの名前は？"        # talk to SOCIAL
./scripts/start-ui.sh                              # owner's UI  on 127.0.0.1:9200
./scripts/start-dashboard.sh                       # admin panel on 127.0.0.1:9119
```

Two interfaces, deliberately separate:

| | For | Port |
|---|---|---|
| **SOCIAL UI** | the owner — 4 screens, Japanese, no jargon | 9200 |
| Hermes dashboard | the developer — 19 pages of tooling | 9119 |

From your own machine, tunnel to the dashboard:

```bash
ssh -L 9200:127.0.0.1:9200 <user>@<vps-host>   # owner's UI
ssh -L 9119:127.0.0.1:9119 <user>@<vps-host>   # admin dashboard
```

The dashboard is loopback-only by design and is never exposed publicly.

## Always use the wrapper

```bash
./scripts/social-hermes <args>     # correct — pins HERMES_HOME to this project
hermes <args>                      # wrong — uses the developer's personal profile
```

## Layout

```
.env  .env.example        secrets (gitignored) and template
.hermes/                  HERMES_HOME — config, SOUL, memory, sessions, skills
config/templates/         committed copies of SOUL.md and config templates
ui/                       owner's UI (React + TS + Vite + Tailwind)
ui_server/                thin adapter bridging that UI to Hermes
extensions/               custom skills/plugins (only where Hermes lacks a feature)
scripts/                  operational bash
tests/                    acceptance criteria and helper scripts
docs/                     architecture, security, operations, setup guides
```

## Documentation

| | |
|---|---|
| [CUSTOM_UI](docs/CUSTOM_UI.md) | The owner's simple four-screen UI |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | How SOCIAL sits on Hermes; memory design |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | Host details; reproducing the environment |
| [SECURITY](docs/SECURITY.md) | Secrets, permissions, network exposure |
| [OPERATIONS](docs/OPERATIONS.md) | Start, stop, logs, troubleshooting |
| [TESTING](docs/TESTING.md) | How to run the acceptance suite |
| [LINE_SETUP](docs/LINE_SETUP.md) | LINE channel and webhook |
| [GOOGLE_SHEETS_SETUP](docs/GOOGLE_SHEETS_SETUP.md) | OAuth2 for Sheets |
| [DAILY_BRIEF](docs/DAILY_BRIEF.md) | Scheduled report design |
| [MIGRATION](docs/MIGRATION.md) | Dev VPS → production VPS |
| [HANDOFF](docs/HANDOFF.md) | Client ownership and key rotation |
| [STATUS](STATUS.md) | Current phase, tests passed, blockers |
| [tests/acceptance.md](tests/acceptance.md) | Acceptance results |

## Security

Never print or commit a secret. `.env` is mode 600 and gitignored; so is the
entire `.hermes/` runtime tree. SOCIAL refuses to store credentials in its
memory (verified — test SEC-02). See [SECURITY.md](docs/SECURITY.md).
