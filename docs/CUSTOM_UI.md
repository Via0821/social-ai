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

## The conversation lives outside React

Each screen used to hold the transcript in its own `useState`. Send a message,
switch tabs before the answer lands, and the screen unmounts — so when the
reply finally arrived, `setState` hit a dead component. The answer was
**discarded and never persisted**. The owner reported it as "history is not
reflected immediately"; the reply had genuinely been thrown away.

`lib/chatStore.ts` holds the messages and the in-flight run at module scope,
so a turn completes and saves regardless of what is mounted. Screens
subscribe through `useSyncExternalStore` (`lib/useChat.ts`) and no longer own
the data — CHAT, TALK and HISTORY all read the same array, so a reply arriving
while HISTORY is open appears there without navigating away and back.

`send()` is deliberately **not awaited** by the caller, for the same reason.

Verified by stubbing `localStorage` and `fetch` and running a turn with **zero
subscribers** — the state a fully unmounted UI is in. The reply still lands in
storage.

### Day grouping

HISTORY groups by the **viewer's local calendar date**, boundary at local
midnight — so a phone in Japan splits days at JST midnight regardless of the
server's timezone. Entries carry `at` (epoch ms), set when appended.

**Messages saved before timestamping must not be dated as "now".** The first
version wrote `new Date(m.at ?? Date.now())`, which stamped undated messages
at *render* time — so every old conversation collapsed into today and the
grouping looked broken. Their real time is gone and cannot be recovered, so
`isUndated()` routes them to a separate 以前の会話 bucket, sorted last. Dated
messages also show a time, so ordering within a day is visible.

Threads were considered and deferred: the owner asked for per-day as the
acceptable minimum, and Hermes' own session grouping does not line up with
what the UI shows.

## Safari will not play a reply unless the element was unlocked by a tap

TALK transcribed the owner correctly and answered in text, but stayed silent.
Not a TTS fault — the audio was generated fine. Browsers only allow `play()`
inside a user gesture, and in TALK every reply plays from deep inside an async
chain (record → transcribe → ask → speak), by which point the gesture context
from the initial tap is long gone. Safari refuses, and the rejection is easy
to swallow.

`lib/audioOut.ts` keeps **one** `Audio` element, unlocked synchronously inside
the tap handler in `begin()` — before any `await` — by playing 50 ms of
silence. An element unlocked by a gesture stays unlocked, so every later reply
reuses it.

Playback failure now reports which kind it was: `NotAllowedError` is the
autoplay block specifically and tells the owner to tap again, anything else is
a genuine playback failure. Either way the mic reopens, so a silent reply
never strands the conversation.

## Files SOCIAL produces

A reply may name a file on the server — Hermes' `MEDIA:<path>` tag, or a bare
path when the agent calls `scripts/generate-image.sh`. **Printing that path
to the browser is useless**: the file is on the VPS, and the owner would have
to SSH in to fetch it. That is exactly what happened on 2026-08-30 — an image
was generated correctly and the reply showed
`/home/dev/Social-ai/.hermes/generated/….png` as text.

`_extract_attachments` now scans every reply for both forms, resolves them
against the two directories that may ever be served
(`.hermes/generated`, `.hermes/uploads`), rewrites them into
`/api/file/<name>` URLs and strips the raw path from the text. The UI renders
images inline with **画像を保存** and **別タブで開く**, plays audio in a
player, and offers anything else as a download.

Resolution is by bare filename only, `resolve(strict=True)` defeats symlinks
pointing elsewhere, and the parent directory must match exactly — so
`MEDIA:/etc/passwd` and `../../..` traversal both return nothing. Verified.

A regex in `Chat.tsx` still short-circuits obvious image requests to skip an
agent round-trip, but it is only an optimisation. It originally missed
「イメージを生成して」 because the alternation lacked イメージ; broadened, but
correctness no longer depends on it, because the server handles the agent
path too.

## Cloudflare will cache authenticated files unless told not to

Found while testing the above, and worth stating plainly: an unauthenticated
request for a generated image returned **HTTP 200** through
`social-ai01.com`, while the same request straight to `127.0.0.1:9200`
returned 401.

The origin was right; Cloudflare had cached the `.png` at the edge
(`cf-cache-status: HIT`, `age: 18`, `cache-control: max-age=14400`) and was
serving it to anyone holding the URL — no passphrase involved.

Every authenticated response now carries `Cache-Control: private, no-store,
max-age=0`, set in the auth middleware so it covers all of them rather than
just the file route. Re-verified: `cf-cache-status: BYPASS`, and
unauthenticated requests return 401 consistently.

Filenames are unguessable (timestamp plus 12 hex chars), so exposure required
knowing the exact URL — but anything served behind a passphrase must forbid
shared caching, whatever the extension.

## Layout (2026-08-30 redesign)

Rebuilt to the owner's mockups: near-black ground, blue glow, and a
three-item bottom bar with TALK raised in the centre.

| Nav | Screen |
|---|---|
| CHAT | text conversation, attachments, image results |
| **TALK** | hands-free voice, raised circular button |
| MENU | HISTORY / MEMORY / BRIEF / CONNECTIONS / SETTINGS / LOG OUT |

MENU's sub-screens swap the header for a back arrow and keep MENU lit in the
bar, so it stays obvious where you are.

### The orb

`components/Orb.tsx` — hand-drawn SVG plus CSS keyframes, a few KB, no
dependency and no network call. Four states, as asked:

| State | Motion |
|---|---|
| idle | slow breathe, 4.5s |
| listening | pulse plus mirrored waveform driven by live mic amplitude |
| thinking | arcs spin roughly 4× faster |
| speaking | quick pulse |

Listening and speaking also scale with measured amplitude, so it tracks the
owner's actual voice rather than looping. `prefers-reduced-motion` disables
all of it.

### Continuous conversation

`lib/voiceLoop.ts` runs listen → detect end of speech → send → speak →
listen, with no button between turns. End-of-speech comes from an
AnalyserNode: RMS amplitude, a speech threshold, and **1.4s** of silence
before submitting. That window is deliberately generous — Japanese carries
natural mid-sentence pauses, and a shorter one cuts the owner off. Nothing is
submitted unless speech was actually heard, so a quiet room never fires an
empty turn.

The mic is paused while SOCIAL speaks (otherwise it transcribes itself) and
reopened the instant playback ends — that hand-back is what makes it feel
like a conversation. A 60s cap stops a stuck mic recording forever.

The transcript renders under the orb and can be collapsed.

## A configured key is not a working one

CONNECTIONS originally reported OpenAI as "connected" whenever
`OPENAI_API_KEY` was set. On 2026-08-30 the account ran out of credit and
every feature stopped — chat, voice, images — while the screen still said
接続済み. That is precisely the wrong thing to show someone trying to work out
why nothing answers.

It now makes a real billed call (`gpt-5-nano`, 1 token), caches the result
for 5 minutes so viewing the screen costs nothing, and translates the error
code: `credit_balance_exhausted` → 「残高切れです。チャージが必要です」,
`invalid_api_key`, `insufficient_quota`, and so on.

`/v1/models` is not usable for this — it returns 200 with an exhausted
balance. Only a billed endpoint reveals the truth.

## Installable app (PWA)

`manifest.webmanifest` plus a small service worker make the browser offer
"add to home screen", so SOCIAL launches from an icon in standalone mode with
no browser chrome. iOS ignores the manifest for this, so the `apple-*` meta
tags in `index.html` are what make it work there.

The service worker **deliberately does not cache API responses**. SOCIAL's
value is current information; a cached brief or a stale memory list would be
worse than showing nothing. Only the app shell is cached.

### Icons

The artwork is **the client's own image**, used as supplied rather than
recreated — an earlier hand-drawn SVG approximation was close but visibly not
theirs. Master kept at `config/brand/icon-source.png` (outside `public/`, so
the 1 MB original is never served); the shipped sizes are cut from it:

```bash
FF=tools/ffmpeg-7.0.2-amd64-static/ffmpeg
SRC=config/brand/icon-source.png
for s in 192 512; do
  "$FF" -y -i "$SRC" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=$s:$s:flags=lanczos" \
    -frames:v 1 "ui/public/icon-$s.png"
done
```

**The maskable variant is a separate file, not the same one reused.** Android
crops maskable icons to a circle and keeps roughly the inner 80%; the sphere
runs to the edge of the frame, so reusing `icon-512.png` shaves its rim off.
`icon-maskable-512.png` scales the sphere to 410px inside a 512px canvas
padded with the artwork's own background:

```bash
"$FF" -y -i "$SRC" -vf \
  "crop='min(iw,ih)':'min(iw,ih)',scale=410:410:flags=lanczos,pad=512:512:51:51:color=0x04070f" \
  -frames:v 1 ui/public/icon-maskable-512.png
```

The header mark reuses `icon-192.png`, so the app and its home-screen icon
are visibly the same thing.

### Icons must be reachable without the session cookie

The home-screen icon came out as a black tile with a white "S" — an icon
nobody had designed. iOS was generating a letter fallback because it could
not load ours.

Cause: `apple-touch-icon` and the manifest's icons are fetched **by the OS,
not the page**, and therefore without the session cookie. The auth middleware
answered `303` to the login HTML, iOS could not read that as an image, and
fell back to a generated tile. The manifest itself was exempt; the icons it
pointed at were not.

`PUBLIC_PATHS` in `ui_server/server.py` now exempts the fixed branding files
and the service worker. They contain nothing private. **`/api/file/*` is
deliberately not in that set** — user content stays behind the passphrase.
Verified after the change: icons and `sw.js` return 200 uncredentialed, while
`/api/file/*`, `/api/memory` and `/` still refuse.

iOS wants `180x180` specifically, so `apple-touch-icon.png` is shipped at
that size alongside the 192/512 pair.

**iOS caches the icon at the moment the site is added to the home screen.**
Fixing the server does not update an icon already on someone's phone — the
shortcut has to be deleted and re-added.

**Bump `SHELL_CACHE` in `sw.js` whenever an icon changes** — it is cached by
the service worker, and a stale cache keeps serving the old one after an
install.

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
