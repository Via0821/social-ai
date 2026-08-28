# SOCIAL — LINE setup

No real secret values appear in this document.

## What's already configured

| Variable | Status |
|---|---|
| `LINE_CHANNEL_ID` | configured |
| `LINE_CHANNEL_SECRET` | configured |
| `LINE_CHANNEL_ACCESS_TOKEN` | **required — not yet provided** |
| `LINE_OWNER_USER_ID` | **required — not yet provided** |

## Obtaining the two missing values

### Long-lived channel access token

1. Open the [LINE Developers Console](https://developers.line.biz/console/).
2. Select the provider, then the **Messaging API** channel for SOCIAL.
3. Go to the **Messaging API** tab.
4. Scroll to **Channel access token (long-lived)** and press **Issue**.
5. Copy the token.

### Owner userId

Either read **Your user ID** on the channel's *Basic settings* tab, or start
the gateway, send the bot one message, and read the `source.userId` value
(begins with `U`) from the webhook log.

### Installing them

Append to `~/Social-ai/.env` — do not paste them into chat:

```bash
LINE_CHANNEL_ACCESS_TOKEN=<token>
LINE_OWNER_USER_ID=U<...>
```

Then `chmod 600 ~/Social-ai/.env` and re-run `./scripts/health-check.sh`.

## Console settings

On the **Messaging API** tab:

- **Use webhook** — ON
- **Webhook URL** — the tunnel URL plus Hermes' LINE webhook path
- **Auto-reply messages** — OFF (otherwise LINE answers before SOCIAL does)
- **Greeting messages** — optional
- **Allow bot to join group chats** — OFF (SOCIAL is single-owner)

## Adapter details (verified against the installed v0.20.4 plugin)

Source: `~/.hermes/hermes-agent/plugins/platforms/line/` (`plugin.yaml`,
`adapter.py`). These are read from the installed version, not from older
documentation.

| | Value |
|---|---|
| Plugin | `line-platform` v1.0.0, kind `platform` |
| Webhook path | `/line/webhook` (`DEFAULT_WEBHOOK_PATH`) |
| Health path | `/line/webhook/health` |
| Default port | `8646` (`LINE_PORT`) |
| Signature check | HMAC-SHA256 using `LINE_CHANNEL_SECRET` |
| Reply strategy | free reply token first, metered Push API as fallback |

### Required environment

| Variable | Purpose |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | long-lived channel access token |
| `LINE_CHANNEL_SECRET` | webhook signature verification |

### Optional environment

| Variable | Purpose |
|---|---|
| `LINE_PORT` | webhook listen port (default `8646`) |
| `LINE_HOST` | bind host — **set to `127.0.0.1`**, then front it with the tunnel |
| `LINE_PUBLIC_URL` | public HTTPS base URL; **required for sending voice/image/video** |
| `LINE_ALLOWED_USERS` | comma-separated `U`-prefixed userIds — the owner allowlist |
| `LINE_ALLOWED_GROUPS` / `LINE_ALLOWED_ROOMS` | leave unset — SOCIAL is single-owner |
| `LINE_ALLOW_ALL_USERS` | **must stay unset/false outside a first webhook test** |
| `LINE_HOME_CHANNEL` | default destination for cron / Daily Brief pushes |
| `LINE_SLOW_RESPONSE_THRESHOLD` | seconds before the slow-response postback button (default 45) |

`LINE_HOME_CHANNEL` should be set to the owner's userId — that is what the
Daily Brief cron job pushes to.

**`LINE_HOST` matters.** The adapter defaults to binding *all* interfaces.
Set `LINE_HOST=127.0.0.1` so only the tunnel can reach it.

**`LINE_PUBLIC_URL` matters for voice.** Outbound audio is served over HTTP
from `/line/media/<token>/<filename>`; without a public base URL, LINE
cannot fetch the file and voice replies fail.

## Webhook exposure

LINE requires a public HTTPS endpoint. **Only the webhook path is exposed —
never the dashboard.**

```
LINE platform
     │  HTTPS
     ▼
Cloudflare Tunnel  (cloudflared, already installed)
     ▼
127.0.0.1:8646/line/webhook → Hermes LINE adapter → SOCIAL
```

Development tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:8646
```

Set the resulting hostname as `LINE_PUBLIC_URL`, and set the console webhook
URL to `https://<hostname>/line/webhook`.

A quick tunnel's hostname changes on every restart, so both values must be
updated each time. Production should use a **named tunnel** with a stable
hostname on a client-owned Cloudflare account — see [MIGRATION.md](MIGRATION.md).

Verify locally before exposing it:

```bash
curl -s http://127.0.0.1:8646/line/webhook/health
```

## Owner-only access

SOCIAL serves one owner. Once `LINE_OWNER_USER_ID` is known, the gateway
allowlist must be restricted to it. An open bot must not be left running
after testing — verified by acceptance test LINE-03.

## Response speed

Client feedback on 2026-08-27: replies were far too slow, and a "still
thinking…" bubble with a **Get answer** button appeared instead of the answer.

### The button

The adapter fires a Template Buttons postback once the model passes
`LINE_SLOW_RESPONSE_THRESHOLD` (default 45s), because LINE's reply token
expires at 60s and a reply token is free while a push is metered. The user
then taps to collect the cached answer.

That trade is wrong for a single-owner assistant: the owner is holding their
phone and wants the answer, not a button. Set to `0`, which disables the
button and pushes the answer when it is ready. The typing indicator still
runs, so there is visible activity.

**Cost of this choice:** slow replies now consume the push quota. The free
plan allows 200 messages/month; usage is visible via
`GET /v2/bot/message/quota/consumption` and is reported by
`scripts/health-check.sh`. Weekday briefs account for ~22, leaving ample
headroom for one user, but it is worth watching.

### The slowness itself

Measured from the gateway log: research turns took **369.8s and 378.9s**
across 4 API calls, while conversational turns took 14.8s and 38.8s. The
model was not the bottleneck — reasoning level made no difference (a greeting
took 4-6s at both `low` and `medium`). The time was in chained tool calls.

`SOUL.md` now caps LINE effort: aim to answer within a minute, one web search
rather than several, batch stock symbols into a single command, and answer
without tools where no lookup is needed. For questions that genuinely need
research, reply briefly and offer to go deeper rather than silently spending
five minutes.

Retested afterwards: 「今日のAI業界のニュースを教えて」 went from ~370s to
**76s**, and ended by offering to expand on any of the three items. PC use is
unaffected — the constraint is LINE-only.

## Formatting

LINE does not render Markdown. `SOUL.md` already instructs SOCIAL to avoid
`**bold**`, `#` headings and code fences on LINE, to use plain `・` bullets,
and to paste URLs bare.
