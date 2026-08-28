# SOCIAL — Handoff to the client

Production must not depend on developer-owned infrastructure or accounts.

## The client must own

| Asset | Currently | At handoff |
|---|---|---|
| Production VPS | not yet contracted | client account |
| OpenAI API account + key | client-provided key, used on the dev VPS | client account, **key rotated** |
| LINE Official Account / channel | client-provided credentials | client account, **token rotated** |
| Google Cloud project + OAuth client | not yet created | client account |
| Cloudflare account (named tunnel) | dev-side tunnel | client account |
| Domain / hostname for the webhook | none | client-owned |
| SOCIAL data (memory, sessions) | dev VPS | migrated, then erased from dev |
| Hermes configuration | `.hermes/` | migrated |
| Custom extensions | `extensions/` | delivered in the repo |
| Repository | dev-side | transferred to the client |

## Credential rotation — required

Every secret used during development passed through a developer-controlled
machine and must be reissued before production:

1. **OpenAI API key** — revoke the development key, issue a new one.
2. **LINE channel access token** — reissue; the old one stops working.
3. **LINE channel secret** — rotate if the console allows.
4. **Gmail password** — rotate. It was transmitted in plaintext. SOCIAL
   never used it (Google access is OAuth2 only), but it was exposed.
5. **Google OAuth client** — create under the client's own Cloud project.

## Decommissioning the development VPS

After the client confirms production is working:

```bash
./scripts/backup.sh                 # final backup, hand to the client
shred -u ~/Social-ai/.env ~/Social-ai/.env.original ~/Social-ai/.hermes/.env
rm -rf ~/Social-ai/.hermes
```

Then revoke the development keys listed above.

## What the client receives

- The `Social-ai` repository (code, scripts, docs, tests — **no secrets**)
- A final state backup (memory, sessions, skills, cron) transferred securely
- This documentation set:
  [ARCHITECTURE](ARCHITECTURE.md) · [DEVELOPMENT](DEVELOPMENT.md) ·
  [SECURITY](SECURITY.md) · [OPERATIONS](OPERATIONS.md) ·
  [TESTING](TESTING.md) · [MIGRATION](MIGRATION.md) ·
  [LINE_SETUP](LINE_SETUP.md) · [GOOGLE_SHEETS_SETUP](GOOGLE_SHEETS_SETUP.md) ·
  [DAILY_BRIEF](DAILY_BRIEF.md)

## Ongoing costs the client should expect

| Item | Note |
|---|---|
| VPS | client's chosen provider |
| OpenAI API | usage-based; the Daily Brief is the main recurring cost |
| Web search | **none** — Hermes' Tavily integration works keyless |
| Market data | **none** — the official stocks skill uses Yahoo Finance |
| Google Sheets | none |
| LINE Messaging API | free tier covers single-owner use |
| Cloudflare Tunnel | free tier is sufficient |

No paid third-party service was introduced. The only recurring API cost is
OpenAI usage.
