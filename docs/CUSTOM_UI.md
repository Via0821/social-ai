# SOCIAL — the owner's UI

A small, Japanese, four-screen web app for the owner. The Hermes dashboard
remains available for the developer and is never shown to the client.

## Why this exists

The original spec said not to build a custom UI (§17, §33) and to use the
Hermes dashboard. The client — who is not a developer — found it
unusable. The spec anticipated this: *"If UI customization becomes genuinely
necessary later, use Hermes' existing frontend ecosystem (React, TypeScript,
Vite, Tailwind CSS)."* That is exactly what this is.

Two facts were established before writing any code, per the custom-code
policy (§45):

1. **The dashboard cannot be simplified by configuration.** Its navigation is
   a hard-coded array — `BUILTIN_NAV_REST` in `web/src/App.tsx` — listing 19
   pages: Sessions, Files, Analytics, Models, Logs, Cron, Skills, Plugins,
   MCP, Channels, Webhooks, Pairing, Profiles, Config, Keys, System, Docs and
   more. Dashboard plugins can only *add* nav items (`buildNavItems`), never
   hide built-in ones. Skins change colors only. Hiding those pages would
   mean forking Hermes' frontend, which breaks on every upgrade.

2. **There is no stable HTTP chat API to build a thin client against.** The
   dashboard drives chat through a PTY (`/api/pty`, xterm.js) with
   `/api/ws` as a TUI-coupled JSON-RPC metadata sidecar. Reproducing that
   faithfully means embedding a terminal — precisely the developer-feeling
   surface we are removing.

## Architecture

```
Browser  (React + TS + Vite + Tailwind, Japanese, 4 screens)
   │  same-origin HTTP + Server-Sent Events
   ▼
SOCIAL UI adapter   127.0.0.1:9200   (ui_server/server.py, ~250 lines)
   ├── serves the built SPA from ui/dist
   ├── POST /api/chat          → one Hermes turn, streamed
   ├── GET/DELETE /api/memory  → MEMORY.md + USER.md
   ├── GET/POST  /api/brief    → latest brief / run now
   └── POST /api/voice/*       → transcribe / speak
   ▼
Hermes CLI  (HERMES_HOME = ~/Social-ai/.hermes)
   ▼
Same memory, same sessions, same SOUL as LINE
```

The adapter holds **no business logic and no AI behaviour**. Every turn runs
through the supported `hermes` CLI against the same `HERMES_HOME`, so the UI,
the CLI and LINE are one assistant with one memory. Verified: a fact stored
through the UI is recalled by a separate CLI process.

### Why a CLI subprocess per turn

It is the only interface Hermes documents as stable. A simple turn costs
about 6 seconds including process start; tool-using turns take minutes
regardless of transport, so startup is not the bottleneck. In exchange, the
adapter has no dependency on Hermes' internal RPC shapes and should survive
upgrades. If Hermes later ships a supported HTTP chat endpoint, `_run_turn`
is the single function to swap.

## Screens

| Screen | Purpose |
|---|---|
| 会話 | Chat. Text or voice in, text or spoken reply. Suggestion chips on an empty conversation. |
| 記憶 | What SOCIAL remembers, grouped into あなたのこと (`USER.md`) and メモ (`MEMORY.md`), each deletable with confirmation. |
| ブリーフ | The latest Daily Brief, plus 今すぐ作成. |
| 設定 | Plain-language status and a short troubleshooting list. No dangerous controls. |

Design rules: large touch targets, no jargon, no IDs or hashes, every state
explained in Japanese, destructive actions confirmed inline.

Two details that matter for Japanese input and slow turns:

- Enter sends, Shift+Enter makes a newline, and `isComposing` is checked so
  IME conversion is never interrupted mid-word.
- Turns emit a heartbeat every 5 seconds; after 10 seconds the UI shows
  elapsed time and explains that research takes a few minutes, so a slow
  answer never looks like a hang.

## Memory: two stores

Hermes' built-in memory is two `§`-delimited files (`ENTRY_DELIMITER =
"\n§\n"` in `tools/memory_tool.py`):

| File | Holds | Shown as |
|---|---|---|
| `USER.md` | what SOCIAL knows about the owner | あなたのこと |
| `MEMORY.md` | SOCIAL's own notes | メモ |

Both must be displayed. Reading only `MEMORY.md` shows an incomplete picture
— during development a preference saved to `USER.md` looked like a lost
memory until the second store was accounted for. Splitting on newlines
instead of `§` would also corrupt multiline entries.

## Running it

```bash
./scripts/start-ui.sh          # builds if needed, serves on 127.0.0.1:9200
```

Development with hot reload:

```bash
cd ui && npm run dev           # 9201, proxies /api to 9200
```

Rebuild after changing the frontend:

```bash
cd ui && npm run build
```

## Authentication

One owner, one passphrase, set as `SOCIAL_UI_PASSWORD` in `.env`.

- Unset **and** bound to loopback → auth is skipped, so local development
  needs no setup.
- Set → every page and API route requires a valid session.
- Unset **and** bound to anything else → `start-ui.sh` refuses to start.

A device stays logged in for `SOCIAL_UI_SESSION_DAYS` (default 30) via an
HttpOnly, SameSite=Lax cookie carrying `expiry.HMAC-SHA256(expiry)`. The
signing key is derived from the passphrase plus a per-install salt at
`.hermes/ui_session_salt`, so **rotating the passphrase invalidates every
existing session** — which is what you want from a rotation.

Persistent sessions matter for the installed app: a login prompt on every
launch from the home screen would defeat the point.

Set `SOCIAL_UI_HTTPS=true` when serving behind the tunnel so the cookie gets
the `Secure` flag. It must stay off on plain-HTTP loopback, or the browser
will refuse to store the cookie at all.

Verified: unauthenticated page → 303 to `/login`; unauthenticated API → 401;
wrong passphrase → 401 after a 1s delay; correct → cookie set, 30-day expiry;
tampered cookie → 401.

## Installable app (PWA)

`manifest.webmanifest` plus a small service worker make the browser offer
"add to home screen", so SOCIAL launches from an icon in standalone mode with
no browser chrome. iOS ignores the manifest for this, so the `apple-*` meta
tags in `index.html` are what make it work there.

The service worker **deliberately does not cache API responses**. SOCIAL's
value is current information; a cached brief or a stale memory list would be
worse than showing nothing. Only the app shell is cached.

Icons are generated into `ui/public/` (192px and 512px, plus a maskable
variant). Regenerate them from `ui/public/icon.svg` if the mark changes.

## Access

Live at **https://social-ai01.com** behind a Cloudflare named tunnel, with
the passphrase login above.

**A trap worth recording:** the tunnel forwards public traffic to
`127.0.0.1:9200`, so `start-ui.sh`'s "refuse a non-loopback bind" guard never
fires — the bind *is* loopback. Publishing the tunnel without a passphrase
would have exposed the UI with no authentication at all and no warning. The
passphrase must be set **before** the hostname is routed, not after.

`start-ui.sh` also used to read `SOCIAL_UI_PASSWORD` before sourcing `.env`,
so it reported "Authentication: OFF" while the server had the password, and
its public-bind guard consulted an empty variable. Both checks now run after
the load.

**HTTP is upgraded in the app, not at the edge.** Cloudflare's "Always Use
HTTPS" is not enabled on this zone, so `http://social-ai01.com` was served
over plain HTTP. That is worse than untidy: the passphrase would cross the
network in clear text, and the session cookie carries `Secure`, so the
browser would refuse to store it — login would fail with nothing on screen
explaining why. The `force_https` middleware now 301s on `X-Forwarded-Proto:
http`, gated on `SOCIAL_UI_HTTPS` so loopback development is unaffected.

It is registered **after** `require_auth`: Starlette runs the most recently
added middleware outermost. Registered first, the auth redirect fired one
extra plaintext hop before the upgrade happened.

### Old note (loopback-only phase)

Reach it the same way as the dashboard:

```bash
ssh -L 9200:127.0.0.1:9200 <user>@<vps>
# then open http://127.0.0.1:9200
```

That is fine for development but **not deliverable to the client** — a
non-developer cannot run an SSH tunnel. Before handoff, pick one:

- **Cloudflare named tunnel + login** — a stable HTTPS address, protected by
  an auth provider. `cloudflared` is already installed.
- **Tailscale** — no public address at all; requires an install on each
  client device.

Either way the adapter must sit behind authentication before it leaves
loopback. Do not simply change the bind address.

## What this does not do

No settings that could break SOCIAL, no model picker, no key management, no
file browser, no logs, no plugin or skill management. Those stay in the
Hermes dashboard, for the developer, on 9119.
