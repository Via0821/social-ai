# SOCIAL — Architecture

## What SOCIAL is

A private, single-user personal AI assistant built **on top of Hermes Agent**.
Hermes is the runtime; SOCIAL is the configuration, personality, memory and
skill set layered onto it. There is no separate SOCIAL backend application.

## Runtime topology

```
Owner
   │
   ├──────── LINE (smartphone)
   │           │
   │           ▼
   │      LINE Gateway  ◄── Cloudflare Tunnel ◄── public HTTPS webhook
   │           │
   └──── Hermes Dashboard (127.0.0.1:9119, SSH tunnel only)
               │
               ▼
            SOCIAL   (SOUL.md + config.yaml + skills)
               │
     ┌─────────┼──────────┐
     ▼         ▼          ▼
   OpenAI    Memory      Tools
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
    Web Search         Stocks         Google Sheets
   (Tavily, keyless)  (read-only)     (OAuth2, read)
        │
        ▼
      Cron
        │
        ▼
  LINE Daily Brief
```

## Process model

Hermes runs as **one long-lived gateway process** plus short-lived CLI
invocations. Both read the same `HERMES_HOME`, so memory and sessions are
shared across every channel.

| Component | Process | Bind |
|---|---|---|
| Dashboard (PC UI) | `hermes dashboard` | `127.0.0.1:9119` — loopback only |
| Messaging gateway | `hermes gateway` | outbound + webhook |
| Cron scheduler | inside the gateway | n/a |
| CLI | `./scripts/social-hermes` | n/a |

## HERMES_HOME — project-local isolation

SOCIAL does **not** use the developer's `~/.hermes`. Everything lives under:

```
~/Social-ai/.hermes/
```

set via `HERMES_HOME` by `scripts/social-hermes`.

Hermes supports this natively: `hermes_constants.py` resolves `HERMES_HOME`
outside `~/.hermes` as a custom deployment root (the same path used for
Docker deployments). This was verified — `hermes status`, `config`, `doctor`
and `dashboard` all resolve their paths under `~/Social-ai/.hermes`.

**Why not a Hermes profile?** Hermes also offers `hermes -p <name>`, which
stores state in `~/.hermes/profiles/<name>`. That would place SOCIAL's data
inside the developer's home rather than the project directory, which
complicates migration to the client's production VPS. A project-local
`HERMES_HOME` keeps the entire system inside one portable directory.

## Model routing

```yaml
# .hermes/config.yaml
model:
  default: gpt-5.2
  provider: openai-api
```

`provider` must be `openai-api` (direct API key). `openai-codex` is the
ChatGPT OAuth path and is **not** what this deployment uses. Provider names
come from `PROVIDER_REGISTRY` in `hermes_cli/auth.py`.

Switching to Claude later is a two-line config change plus an
`ANTHROPIC_API_KEY` — no SOCIAL code changes. The model is never hard-coded.

## Memory — two layers

| Layer | Mechanism | Holds |
|---|---|---|
| 1. Persistent memory | Hermes `memory` tool → `.hermes/memories/` | Curated: preferences, decisions, goals, standing rules |
| 2. Session search | Hermes `session_search` tool → `.hermes/sessions/` + `state.db` | Full conversation history, searched on demand |

Layer 1 stays small and hand-curated. Layer 2 is the fallback for "what did
we decide last week?". SOUL.md instructs SOCIAL to check layer 1 first, then
search layer 2, and to say so plainly when nothing is found.

Because both layers live in `HERMES_HOME`, **LINE and PC share one memory**.

## Secrets

`~/Social-ai/.env` is the single source of truth (chmod 600, gitignored).
`scripts/social-hermes` sources it and Hermes additionally reads
`.hermes/.env`. Secrets never enter git, logs, docs, or SOCIAL's memory.
See [SECURITY.md](SECURITY.md).
