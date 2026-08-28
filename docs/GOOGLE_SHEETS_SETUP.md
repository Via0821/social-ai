# SOCIAL — Google Sheets setup

## Authentication policy

**OAuth2 only.** Password-based login and browser automation against Google
are prohibited (spec §15).

The client supplied a Gmail password. It is **not used**, is **not** in the
working `.env`, and must not be stored in SOCIAL's memory. It survives only
in `.env.original` (mode 600, gitignored) and should be rotated.

`GOOGLE_ACCOUNT_EMAIL` is retained — it is not a secret, it merely records
which account to authorize.

## HUMAN ACTION REQUIRED

**Purpose:** allow SOCIAL to read authorized Google Sheets.

**Please do:**

1. Open the [Google Cloud Console](https://console.cloud.google.com/) signed
   in as the account SOCIAL should use.
2. Create a project (e.g. `social-assistant`).
3. **APIs & Services → Library** → enable **Google Sheets API**.
   (Also enable **Google Drive API** only if opening sheets by name rather
   than by ID.)
4. **APIs & Services → OAuth consent screen** → **External** → add the
   account as a **Test user**. Publishing the app is unnecessary.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   → application type **Desktop app**.
6. Download the client JSON.
7. Create one **non-sensitive** test spreadsheet with a little sample data.

**Send/provide back:**

- The OAuth client JSON, placed directly on the VPS at
  `~/Social-ai/.hermes/google_oauth_client.json` with `chmod 600`
- The test spreadsheet's ID (the long string in its URL)

**Do NOT send:**

- The Gmail password
- Any spreadsheet containing API keys, tokens or account credentials
- Screenshots showing secret values

## Error 403: access_denied

The commonest failure, and not a misconfiguration on our side. Google puts a
new OAuth app in **Testing** mode, where only listed test users may consent —
and **owning the project does not add you automatically**. The account sees:

> SOCIAL は Google の審査プロセスを完了していません

Fix: add the account at <https://console.cloud.google.com/auth/audience> →
**Test users** → **+ ADD USERS**, then retry the authorization URL.

Publishing the app is **not** needed and should be avoided — it would trigger
Google's verification review, which is pointless for a single-user assistant.
Test-user mode is the correct end state here.

Refresh tokens issued under Testing mode expire after 7 days, which is
acceptable for development. Before handoff, move the app to **In production**
(still without verification, since only the owner's own account is used) so
the refresh token stops expiring.

## Authorizing

Headless OAuth on a VPS needs the consent URL opened on a machine with a
browser. Confirm the flow for the installed version:

```bash
./scripts/social-hermes skills list | grep -i google
./scripts/social-hermes config check
```

Tokens are written under `HERMES_HOME` and are gitignored.

## The agent must get Hermes' Python, or it silently scrapes instead

Found 2026-08-27, and worth understanding because the failure is invisible.

The skill's docs tell the agent to run `python $SCRIPT`. On this host
`python` does not exist and `python3` is the system 3.8, which has none of
Hermes' libraries — so `google_api.py` dies on `import googleapiclient`.

The agent does not report that as a failure. It falls back to fetching the
spreadsheet over the public web and summarising what it scrapes. The answer
looks correct, so nothing appears wrong. But it only works for a
**link-shared** sheet, bypasses OAuth entirely, and a private sheet would
fail with no obvious cause. The first GS-03 run did exactly this and said so
only in a closing aside.

Execution path decides the outcome:

| Path | `python3` resolves to | Sheets API |
|---|---|---|
| Gateway (LINE, cron) | 3.11 in Hermes' venv — the systemd unit puts it on PATH | works |
| CLI / owner's UI | was `/usr/bin/python3` 3.8 | failed, then scraped |

`scripts/social-hermes` now prepends Hermes' venv bin to `PATH`, mirroring
the unit, resolved from the `hermes` entry point rather than hard-coded. The
UI adapter shells out through that wrapper, so it is fixed there too.

**When testing Sheets, confirm the read went through the API.** A plausible
summary is not evidence — ask which tool produced it, or use a sheet that is
not link-shared.

## Scopes — deliberately narrowed

The stock `google-workspace` skill requests a very wide scope set:

```
gmail.readonly  gmail.send  gmail.modify  calendar
drive  contacts.readonly  spreadsheets  documents
```

Gmail, Calendar, Drive and Docs are all **out of scope** for this MVP
(spec §17), and `spreadsheets` is read/write where §25 asks for read-only.
Putting a consent screen in front of the client that says *"read and send
your email, manage all your Drive files"* — to summarise one spreadsheet —
is not acceptable.

`SCOPES` in `.hermes/skills/productivity/google-workspace/scripts/setup.py`
is therefore narrowed to:

```
https://www.googleapis.com/auth/spreadsheets.readonly
```

The stock file is preserved beside it as `setup.py.orig`.

**Consequences, accepted deliberately:**

- Opening a sheet by *name* will not work — that needs Drive. Use the
  spreadsheet ID or URL, which is what the MVP does anyway.
- Drive listing, sheet writes, and the Gmail/Calendar/Docs helpers are off.

The skill's `--check-live` probe was also repointed: it called Calendar,
which a sheets-only token cannot reach. It now probes Sheets with a
deliberately absent spreadsheet id — a 404 proves the token is accepted.

**After a skill update, re-apply both changes.** `hermes skills install`
overwrites the working copy.

To widen later (for example if the client wants SOCIAL to write into a
sheet), add the scope to `SCOPES` and re-run the OAuth flow — a new consent
is required, existing tokens do not gain scopes.

## Scope for the MVP

**Read-only.** SOCIAL may read explicitly authorized sheets, summarize,
analyze and answer questions. It must not write to or modify client sheets
unless that is separately requested and approved.

Typical use:

```
このスプレッドシートを要約して
今月の数字の傾向を分析して
```

## Credential spreadsheets — hard rule

If a spreadsheet holds API keys, passwords or LINE secrets, **its contents
must never be indexed as SOCIAL knowledge or written to memory** (spec §26).
Infrastructure credentials belong in `.env`, not in the assistant. `SOUL.md`
encodes this rule.
