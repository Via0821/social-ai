# SOCIAL Development Status

_Last updated: 2026-08-22_

## Environment

| | |
|---|---|
| Host | Ubuntu 20.04.6 LTS · 5 vCPU · 14 GiB RAM · 218 GB disk (5% used) |
| User | `dev` (sudo requires password — see Human Action Required) |
| Project root | `~/Social-ai` |
| `HERMES_HOME` | `~/Social-ai/.hermes` (project-local, isolated) |
| Runtime Python | 3.11.16 (Hermes venv); system Python is 3.8.10 and unused |

## Hermes Version

Hermes Agent **v0.20.4** (2026.8.18), upstream `443d4387`, git install at
`~/.hermes/hermes-agent`. Pre-existing — not installed by this project.
Hermes source is unmodified.

## Current Phase

Phases 0–9 and 14–15 complete, plus a custom owner-facing UI (added
2026-08-23 at the client's request). Phases 10–13 (LINE, voice-over-LINE, Google
Sheets) are gated on client-side credentials.

## Completed

- **Phase 0 — VPS audit.** Full inventory recorded in `docs/DEVELOPMENT.md`.
  Existing `~/.hermes` and the `social-dev` profile left untouched.
- **Phase 1 — Project init.** Directory structure, `.gitignore`,
  `.env.example`, `scripts/social-hermes` wrapper pinning `HERMES_HOME`.
- **Credential normalization.** The client's `.env` was free-form prose with
  zero parseable `KEY=VALUE` pairs. Normalized without ever reading values
  aloud, using shape-based classification with strict pattern assertions
  (`tests/scripts/normalize_env.py`). Original preserved as `.env.original`
  (chmod 600, gitignored).
- **Phase 2 — Hermes.** Verified working under project-local `HERMES_HOME`;
  `config migrate` run (v0 → v38).
- **Phase 3 — OpenAI.** Key validated against the live API (124 models
  available, including `gpt-5.2` and OpenAI STT/TTS). Provider set to
  `openai-api`, model `gpt-5.2`.
- **Phase 4 — SOCIAL identity.** `SOUL.md` written (Japanese, ~6.5 KB):
  personality, fact/inference/memory separation, two-layer memory policy,
  credential refusal, LINE formatting rules, voice-reply style.
- **Phase 5 — CLI.** Japanese conversation verified; quality is good and
  SOUL rules are visibly followed.
- **Phase 6 — Dashboard.** Running on `127.0.0.1:9119`, HTTP 200, loopback
  only, external access refused.
- **Phase 7 — Memory.** Persistent memory, cross-session recall, and session
  history search all verified end-to-end.
- **Phase 8 — Web search.** Tavily works **keyless** — no paid search
  provider needed. Live search returned same-day news with real URLs.
- **Phase 9 — Markets.** Installed the official `finance/stocks` skill
  (Yahoo Finance, read-only). Live quotes and a real one-month analysis with
  computed volatility and drawdown.
- **Phase 12 (partial) — Voice pipeline.** Japanese TTS→STT round-trip
  verified through Hermes' own transcription tool. Required a config fix:
  Hermes defaults STT to local faster-whisper, which **is not installed**, so
  `stt.provider` was set to `openai` with `gpt-4o-transcribe`.
- **Phase 14 — Daily Brief.** Job created (paused) and its content pipeline
  verified end-to-end: all six sections researched live, 9 sourced URLs,
  fact/interpretation separated, LINE-safe formatting.
- **Phase 15 — 24/7 gateway.** Installed as a systemd user service with
  `Restart=always`; **linger was enabled automatically**. Restart tested for
  real — memory and cron both survived.

## Owner's UI (added 2026-08-23)

The client found the Hermes dashboard too complex — reasonably, since it
exposes 19 developer pages. Its nav is a hard-coded array and its chat runs
through a PTY, so it can neither be simplified by configuration nor wrapped
by a thin client. A small React/TS/Vite/Tailwind app now serves four
Japanese screens (会話 / 記憶 / ブリーフ / 設定) on `127.0.0.1:9200`, bridged
to Hermes by a ~250-line adapter that runs turns through the supported CLI.
The dashboard stays on 9119 for development. Full rationale and the
evidence behind it: [docs/CUSTOM_UI.md](docs/CUSTOM_UI.md).

## Tests Passed

| ID | Feature | Result |
|---|---|---|
| CORE-01 | Hermes starts | PASS |
| CORE-02 | OpenAI responds | PASS (live API) |
| JP-01 | Japanese conversation | PASS |
| JP-02 | SOCIAL identity | PASS |
| UI-01 | localhost dashboard | PASS (HTTP 200, loopback-only verified) |
| MEM-01 | Explicit memory | PASS |
| MEM-02 | Memory survives new session | PASS (separate process) |
| MEM-03 | Session history recall | PASS (cited session id + timestamp) |
| WEB-01 | Current web search | PASS (same-day news) |
| WEB-02 | Real source retrieval | PASS (URLs + dates) |
| FIN-01 | Stock quote | PASS (live Yahoo Finance) |
| FIN-02 | Market analysis | PASS (1-month history, computed metrics) |
| VOICE-01 | Japanese STT | PASS (via Hermes transcription tool) |
| VOICE-02 | Japanese TTS | PASS (audio generated) |
| CRON-01 | Daily Brief generation | PASS (6/6 sections, 9 sources) |
| SYS-01 | Gateway restart | PASS (real restart) |
| SYS-02 | Memory persists | PASS |
| SYS-03 | Cron persists | PASS |
| UI-00 | Owner's custom UI (all endpoints + screens) | PASS |
| UI-02 | UI ↔ CLI shared memory | PASS |
| SEC-01 | No secrets committed | PASS (none secret) |
| SEC-02 | Refuses to memorize credentials | PASS (verified nothing written to disk) |
| SEC-03 | Dashboard not publicly bound | PASS |

## In Progress

Nothing actively in progress. Remaining work is gated on the items below.

## Human Action Required

### 0. The client must buy a production VPS

The current host is the **developer's personal development VPS**. Production
on it would violate §50 and leave the client's data and continuity dependent
on developer-owned infrastructure. Raised with the client 2026-08-26.

Spec derived from measured usage (see docs/MIGRATION.md): 2–4 vCPU, **8 GB
RAM** (4 GB minimum — 2 GB will swap during a brief), 50–100 GB SSD, Ubuntu
24.04 LTS, headless. ConoHa is suggested because the client's existing
お名前.com and ロリポップ accounts are both GMO.

The account must be in the client's own name. Setup and migration are ours.

**What does NOT need to wait for it:** the LINE toggle and first message
(the captured userId is permanent), the Google test-user registration
(Google-side, host-independent), and the Cloudflare nameserver move (carries
over intact, and its propagation delay is best absorbed early).

**What does wait:** the permanent tunnel on the real hostnames, the final
LINE webhook URL, the UI passphrase and public exposure, and the data
migration.

### 1. LINE — two console clicks, then one message

**Resolved 2026-08-24:** the access token is installed and validated; the
webhook is registered and LINE's own test returns 200.

Still needed from the client:

1. LINE console → Messaging API → **"Webhook の利用" → ON**
   (`active: false` today; the API cannot set this toggle)
2. Send SOCIAL any one message from the owner's phone

Then run `./scripts/find-line-user.sh` to capture `LINE_OWNER_USER_ID`, and
`./scripts/sync-env.sh` to turn it into the allowlist and the Daily Brief
push target.

Needed before Phase 10. `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` are
already configured; these two are not:

- `LINE_CHANNEL_ACCESS_TOKEN` — LINE Developers Console → your Messaging API
  channel → "Messaging API" tab → **Channel access token (long-lived)** → Issue.
- `LINE_OWNER_USER_ID` — the owner's own LINE `userId` (starts with `U`).
  Obtainable from the console's "Your user ID" field, or captured from the
  first inbound webhook event.

Add them to `~/Social-ai/.env` as `KEY=value` lines. **Do not paste them into
chat.**

### 2. Google — OAuth2 client for Sheets

Needed before Phase 13. A Google Cloud project with the Sheets API enabled
and an OAuth2 client (Desktop type), plus one non-sensitive test
spreadsheet. The Gmail **password will not be used**.

### 3. Daily Brief schedule

Delivery time, timezone, and frequency (daily vs weekdays) have not been
specified. A manually-triggered brief will be built first; the recurring
schedule needs this answer.

### 4. How should the client reach the UI?

The owner's UI is loopback-only, because the adapter has no authentication
of its own. A non-developer cannot run an SSH tunnel, so before handoff this
needs either a **Cloudflare named tunnel with login** (cloudflared is already
installed) or **Tailscale**. Deferred by your decision on 2026-08-23; not
blocking development. Do not simply change the bind address — the adapter
must sit behind authentication first.

### 5. Approval for a host reboot test (SYS-04)

The gateway service is enabled with linger on, so it is configured to start
at boot — but that has not been *proven* by an actual reboot, and rebooting
would drop the current working session. Say the word and it can be run.

_(The earlier concern about `sudo loginctl enable-linger` is resolved —
`hermes gateway install` enabled linger by itself.)_

### 6. Rotate the Gmail password

It was transmitted in plaintext. It is not used by SOCIAL and is not in the
working `.env`, but it should be rotated.

## Blockers

- **LINE (Phases 10–12)** — needs `LINE_CHANNEL_ACCESS_TOKEN` and the owner's
  userId. Everything else for LINE is prepared: the adapter's exact
  variables, port (8646) and webhook path (`/line/webhook`) are documented in
  `docs/LINE_SETUP.md`, `cloudflared` is installed, and `scripts/sync-env.sh`
  will wire the credentials through in one command.
- **Google Sheets (Phase 13)** — needs an OAuth2 client. The
  `google-workspace` skill is already available.
- **Daily Brief schedule** — job is built and verified, but stays paused
  until the delivery time and timezone are confirmed.

## Known Issues

- Hermes `doctor` reports npm audit warnings in its bundled `web` and
  `ui-tui` workspaces. Upstream Hermes issue, not SOCIAL code; dashboard is
  loopback-only so exposure is minimal.
- `hermes model` and `hermes setup` are interactive-only; configuration is
  done via `hermes config set` instead.
- The config key for the provider is `model.provider`, and the value for a
  direct OpenAI key is `openai-api` (not `openai`).

## Next Step

Waiting on the client for the LINE access token, the owner userId, the
Google OAuth client, and the Daily Brief schedule. Once the LINE token
arrives, Phases 10–12 can be completed in one pass:

```bash
# add the two LINE values to .env, then:
./scripts/sync-env.sh
./scripts/social-hermes gateway restart
cloudflared tunnel --url http://127.0.0.1:8646
# set the webhook URL in the LINE console, then run LINE-01…06
```
