# SOCIAL — Operations

All commands assume `~/Social-ai` as the working directory. Every Hermes
invocation goes through `./scripts/social-hermes`, which pins
`HERMES_HOME=~/Social-ai/.hermes` and loads `.env`. Never call bare `hermes`
— that would use the developer's personal profile.

## Quick reference

| Task | Command |
|---|---|
| Health check | `./scripts/health-check.sh` |
| Agent status | `./scripts/social-hermes status` |
| Diagnose config | `./scripts/social-hermes doctor` |
| Start owner's UI | `./scripts/start-ui.sh` |
| Rebuild owner's UI | `cd ui && npm run build` |
| Start dashboard (admin) | `./scripts/start-dashboard.sh` |
| Stop dashboard | `./scripts/social-hermes dashboard --stop` |
| Dashboard status | `./scripts/social-hermes dashboard --status` |
| Start gateway | `./scripts/start-gateway.sh` |
| Stop gateway | `./scripts/stop-gateway.sh` |
| Gateway status | `./scripts/social-hermes gateway status` |
| List cron jobs | `./scripts/social-hermes cron list` |
| Logs | `./scripts/social-hermes logs` |
| Sync secrets into Hermes | `./scripts/sync-env.sh` |
| Backup | `./scripts/backup.sh` |
| Migration readiness | `./scripts/migration-check.sh` |
| One-off prompt | `./scripts/social-hermes -z "……"` |
| Interactive chat | `./scripts/social-hermes chat` |

## Two interfaces

| | Audience | Port | Contents |
|---|---|---|---|
| SOCIAL UI | the owner | 9200 | 会話 / 記憶 / ブリーフ / 設定 |
| Hermes dashboard | the developer | 9119 | 19 pages of tooling |

Both are loopback-only. See [CUSTOM_UI.md](CUSTOM_UI.md).

## PC access — SSH tunnel

The dashboard binds `127.0.0.1:9119` and is never publicly exposed. From
your workstation:

```bash
ssh -L 9119:127.0.0.1:9119 <user>@<vps-host>
```

Then open <http://127.0.0.1:9119> in the local browser.

```
Workstation browser → localhost:9119 → SSH tunnel → VPS localhost:9119 → dashboard → SOCIAL
```

If port 9119 is busy locally, use `-L 9200:127.0.0.1:9119` and browse to
port 9200 instead.

## After changing a credential

`.env` is the source of truth, but Hermes and the systemd gateway read
`.hermes/.env`. After editing `.env`:

```bash
./scripts/sync-env.sh                       # copies the keys Hermes needs
./scripts/social-hermes gateway restart     # pick up the change
```

`sync-env.sh` also derives values the LINE adapter expects: setting
`LINE_OWNER_USER_ID` in `.env` populates both `LINE_ALLOWED_USERS` (the
owner allowlist) and `LINE_HOME_CHANNEL` (the Daily Brief push target), and
it pins `LINE_HOST=127.0.0.1` so the webhook stays behind the tunnel. It
prints key names only, never values.

## 24/7 services

Three **systemd user services**, all `Restart=always`, all enabled at boot,
with linger on so they survive logout:

| Unit | Role |
|---|---|
| `hermes-gateway` | agent, LINE intake, cron |
| `social-ui` | the owner's UI on 9200 |
| `social-tunnel` | Cloudflare tunnel |

`social-ui` was added on 2026-09-02 after the UI went down and stayed down:
it was the only component started by hand, so nothing brought it back. Use
`systemctl --user start social-ui` rather than `scripts/start-ui.sh`, which
is now only for foreground debugging.

Install it with `./scripts/install-ui-service.sh`.

Day-to-day commands live in [RUNBOOK.md](RUNBOOK.md).

```
~/.config/systemd/user/hermes-gateway.service
```

`Restart=always`, `RestartSec=5`, and `HERMES_HOME` pinned to the project.
Linger is enabled (`loginctl show-user dev` → `Linger=yes`), so it survives
SSH logout and is enabled to start at boot.

```bash
./scripts/social-hermes gateway status
journalctl --user -u hermes-gateway -f
```

The cron scheduler runs **inside** the gateway — if the gateway is stopped,
scheduled jobs do not fire. `cron status` warns when this is the case.

## Logs

```
~/Social-ai/.hermes/logs/
```

`./scripts/social-hermes logs` tails the active log. Logs may contain
conversation content — treat them as private and never commit them
(`.hermes/` is gitignored).

## Changing the model

```bash
./scripts/social-hermes config set model.default gpt-5.2
./scripts/social-hermes config set model.provider openai-api
```

Provider names come from `PROVIDER_REGISTRY` in `hermes_cli/auth.py`. For
direct OpenAI API keys the provider is `openai-api` — **not** `openai`,
which is not a registry entry and fails with `Unknown provider`.

To move to Claude later: add `ANTHROPIC_API_KEY` to `.env`, then set
`model.provider anthropic` and a Claude model id. No SOCIAL code changes.

## Restart procedure

```bash
./scripts/stop-gateway.sh
./scripts/social-hermes dashboard --stop
./scripts/start-gateway.sh
./scripts/start-dashboard.sh
./scripts/health-check.sh
```

Memory, sessions and cron all persist across restarts — they are on disk in
`HERMES_HOME`, not in process state.

## Troubleshooting

| Symptom | Check |
|---|---|
| `HTTP 401: Missing Authentication header` | `model.provider` is wrong (should be `openai-api`) or the key is not loaded |
| `Unknown provider 'x'` | Name is not in `PROVIDER_REGISTRY` |
| Dashboard won't start | Port in use: `ss -tlnp \| grep 9119` |
| Config warnings in doctor | `./scripts/social-hermes config migrate` |
| Wrong memory / empty history | `HERMES_HOME` not set — you called bare `hermes` |
