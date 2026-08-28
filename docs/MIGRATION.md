# SOCIAL — Migration: development VPS → production VPS

**Do not migrate yet.** The client has not contracted the production server.
This document is the prepared procedure.

## What must transfer

| Item | Location |
|---|---|
| Hermes config | `.hermes/config.yaml` |
| SOCIAL personality | `.hermes/SOUL.md` (committed copy: `config/templates/SOUL.md`) |
| Persistent memory | `.hermes/memories/` |
| Session history | `.hermes/sessions/`, `.hermes/state.db` |
| Installed skills | `.hermes/skills/` |
| Plugins | `.hermes/plugins/`, `extensions/` |
| Cron jobs | `.hermes/cron/` |
| Operational scripts | `scripts/` |
| Documentation | `docs/`, `README.md`, `tests/` |

Because everything lives under one project directory, migration is a
directory move plus a Hermes reinstall — there is no database to dump and no
external service to re-point except the tunnel and the LINE webhook.

## The production VPS — specification

The current host is the **developer's personal development VPS**. Production
must run on client-owned infrastructure (spec §50). The client has to buy
this; it is not optional and it has a lead time, so it should be raised early.

### Measured requirements

Taken from this deployment, not guessed:

| Component | Idle RSS |
|---|---|
| Hermes gateway | 213 MB |
| Hermes dashboard | 312 MB |
| SOCIAL UI adapter | 51 MB |
| cloudflared | 37 MB |
| **Total idle** | **~615 MB** |

Disk: Hermes install 1.4 GB + bundled Node 227 MB + project 353 MB ≈ **2 GB**
before the OS. Memory and sessions grow slowly; briefs are a few KB each.

Peaks come from tool use — a Daily Brief spawns sandbox subprocesses for
search and market data and runs for several minutes.

### Recommendation

| | Minimum | Recommended |
|---|---|---|
| vCPU | 2 | 2–4 |
| RAM | 4 GB | 8 GB |
| Disk | 50 GB SSD | 100 GB SSD |
| OS | Ubuntu 22.04 LTS | **Ubuntu 24.04 LTS** |

**Do not choose 2 GB.** Idle is ~615 MB, but a brief with concurrent tool
subprocesses plus OS overhead will make 2 GB swap and time out.

**Headless — no desktop environment.** The dev host runs Chrome Remote
Desktop and an IDE; none of that is used by SOCIAL at runtime. Hermes'
browser tools report 11 unmet system dependencies and are unused by any MVP
feature. Chrome here was only ever the developer's screenshot tool.

**Ubuntu 24.04 over 20.04.** This host is on 20.04, whose standard support
ended in April 2025. Hermes ships its own Python 3.11, so the system Python
version is not a constraint — pick the newer LTS for security updates.

### Provider

The client already uses お名前.com (domain) and ロリポップ (hosting), both
GMO. **ConoHa VPS is also GMO**, so it consolidates billing and account
management under a vendor they already have a relationship with — worth
mentioning, though さくらのVPS and Xserver VPS are equally suitable. Overseas
providers (Hetzner, Vultr, DigitalOcean) cost less but bill in USD/EUR with
English-only support.

Whichever is chosen, **the account must be in the client's name**, not the
developer's.

### ConoHa: pick the OS image, not the application image

Observed 2026-08-27 — the client drifted onto the **エディション** tab, which
sells the WordPress/KUSANAGI application image:

| | イメージタイプ → OS | エディション (WordPress) |
|---|---|---|
| 4 GB | **¥1,379/mo, 4 vCPU** | ¥8,140/mo, 2 vCPU |

Same memory, ~6× the price, half the CPU, and a preinstalled stack SOCIAL
does not use. Always confirm the **イメージタイプ → OS → Ubuntu 24.04** path
before paying, and sanity-check the monthly total.

The 4 GB OS plan is 4 vCPU / 100 GB SSD, which comfortably exceeds the
measured requirement.

### Packages to install

```bash
sudo apt update && sudo apt install -y ffmpeg git curl
```

`ffmpeg` is needed for voice (STT silence-trimming). Installing the system
package avoids the 200 MB static build Hermes otherwise downloads into the
project. Python 3.11 and Node ship with Hermes.

## Procedure

### 1. On the production VPS

```bash
# Install Hermes Agent per upstream Linux instructions, then:
git clone <repo> ~/Social-ai
cd ~/Social-ai
```

### 2. Transfer runtime state

```bash
./scripts/backup.sh                      # on the dev VPS
scp backups/social-backup-*.zip prod:~/  # transfer
./scripts/social-hermes import ~/social-backup-*.zip   # on production
```

The backup contains secrets — transfer over SSH only, and delete both copies
afterwards.

### 3. Install client-owned credentials

```bash
cp .env.example .env && chmod 600 .env
```

Fill in the client's own keys. **Every credential should be newly issued**,
not copied from development — see [HANDOFF.md](HANDOFF.md).

### 4. Re-point external services

- **LINE webhook** → the production tunnel hostname
- **Cloudflare** → a **named tunnel** on the client's account, not a quick
  tunnel (dev quick-tunnel hostnames change on every restart)
- **Google OAuth** → re-authorize against the client's Cloud project

### 5. Enable 24/7 operation

```bash
sudo loginctl enable-linger <user>   # user services survive logout/reboot
```

Then install the gateway service and verify by an actual reboot.

### 6. Verify

```bash
./scripts/migration-check.sh
./scripts/health-check.sh
```

Then re-run the full suite in [`tests/acceptance.md`](../tests/acceptance.md)
— particularly LINE-05/06 (shared memory) and SYS-01…03 (restart).

## Portability constraints already observed

- No hard-coded home directories in scripts — every script resolves
  `PROJECT_ROOT` from its own location.
- No dependency on the development VPS IP.
- No dependency on an ephemeral tunnel URL in committed configuration.
- `HERMES_HOME` is project-relative, never `~/.hermes`.
- The model is configuration, not code — the provider can change without
  touching SOCIAL.

`./scripts/migration-check.sh` enforces these and fails if one regresses.

## Left behind deliberately

`~/.hermes/profiles/social-dev` on the development VPS is an earlier
exploratory profile. It is not part of SOCIAL and must not be migrated.
