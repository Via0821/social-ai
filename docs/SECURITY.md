# SOCIAL — Security

## Principles

1. Secrets live in `.env` files with mode `600`, never in git, logs, docs or AI memory.
2. Nothing binds to a public interface except the LINE webhook.
3. Google access uses OAuth2. Password authentication is prohibited.
4. SOCIAL is single-owner. Inbound messaging is allowlisted.
5. Market and Sheets access is read-only.

## Secret locations

| Path | Contents | Mode | Git |
|---|---|---|---|
| `~/Social-ai/.env` | Source of truth for all secrets | 600 | ignored |
| `~/Social-ai/.env.original` | Client's original unformatted paste, kept verbatim | 600 | ignored |
| `~/Social-ai/.hermes/.env` | Subset Hermes reads directly | 600 | ignored |

`.gitignore` excludes `.env`, `.env.*` (except `.env.example`), the whole
`.hermes/` runtime tree, `*.pem`, `*.key`, `*credentials*.json`,
`*token*.json`, logs and backups.

Verify before any commit:

```bash
git status --porcelain --ignored | grep -E '\.env|\.hermes' # should all be '!!' (ignored)
git ls-files | grep -E '\.env$|credential|token|secret'      # must be empty
```

## The Gmail password

The client supplied a Gmail address and password. **The password is not used
and is not present in the working `.env`.** It remains only in
`.env.original`, which is mode 600 and gitignored.

Google Sheets access will use OAuth2 (spec §15/§25). The address is retained
as `GOOGLE_ACCOUNT_EMAIL` — not a secret, it only identifies which account to
authorize.

**Recommended:** the client should rotate that Gmail password, since it was
transmitted in plaintext.

## Credentials must never enter SOCIAL's memory

`SOUL.md` instructs SOCIAL to refuse storing API keys, tokens, passwords,
OTPs, private keys and OAuth secrets in persistent memory, and to redirect
the owner to `.env`. **Verified by test SEC-02** — SOCIAL refused a supplied
key and nothing was written to `.hermes/memories/MEMORY.md`.

The same rule covers spreadsheets: if a Sheet contains infrastructure
credentials, its contents must not be memorized. Infrastructure credentials
are not SOCIAL knowledge (spec §26).

## Network exposure

| Service | Bind | Reachable from |
|---|---|---|
| Hermes dashboard | `127.0.0.1:9119` | SSH tunnel only |
| LINE webhook | Cloudflare Tunnel | LINE platform only |
| SSH | `0.0.0.0:22` | pre-existing host config |

The dashboard must never bind `0.0.0.0`. `scripts/start-dashboard.sh`
refuses a non-loopback host. Hermes itself also requires an auth provider on
any public bind (the `--insecure` flag is a documented no-op as of the
June 2026 hardening).

Only the LINE webhook path is exposed publicly — never the dashboard.

## LINE owner restriction

Once the owner's LINE `userId` is known it goes in `LINE_OWNER_USER_ID` and
into the gateway allowlist. A permanently open bot must not be left running.
Verified by test LINE-03.

## Handling secrets during development

Do not `cat .env`, `printenv`, or echo a key. Use existence checks:

```bash
[[ -n "${OPENAI_API_KEY:-}" ]] && echo "configured" || echo "missing"
```

`scripts/health-check.sh` and `tests/scripts/inspect_env.py` follow this
rule — they report presence, length and character class, never a value.

## Production ownership

Production must run on client-owned infrastructure with client-owned
credentials. See [HANDOFF.md](HANDOFF.md). Every key currently in use should
be rotated at handoff, since it passed through the development VPS.
