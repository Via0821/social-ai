# SOCIAL — Daily Brief

A single consolidated Japanese report pushed to LINE on a schedule, built on
Hermes Cron. No separate scheduler is introduced.

## Format

```
SOCIAL Daily Brief
YYYY-MM-DD

1. 株価・市場
2. 重要ニュース
3. AI関連最新情報
4. ビジネストレンド
5. 求人・採用市場
6. 求人媒体・採用手法の変化

今日特に重要な3点
- ...
- ...
- ...

Sources
- ...
```

## Content rules

- **Current information only** — every section is researched at run time via
  web search or the market tools. Nothing is answered from the model's
  training data.
- **Meaningful developments only.** A section with nothing genuinely new says
  so briefly rather than padding.
- **No duplicates** across sections or across consecutive days.
- **Concise Japanese**, LINE-safe formatting (no Markdown — see
  [LINE_SETUP.md](LINE_SETUP.md)).
- **Source URLs** wherever possible, with dates.
- **Facts separated from analysis**, per `SOUL.md`. Market commentary is
  interpretation and must be labelled as such.
- **Never fabricate** a number, quote or headline. If retrieval fails, the
  brief says the data could not be retrieved.

## Reading a scheduled run

A cron run and the UI's 今すぐ作成 button take different paths, and they used
to disagree about what "the brief" is.

`cron/scheduler.py` writes each agent-mode run to
`.hermes/cron/output/<job_id>/<YYYY-MM-DD_HH-MM-SS>.md` in this shape:

```
# Cron Job: <name>
**Job ID:** …  **Run Time:** …  **Schedule:** …

## Prompt
<the ENTIRE prompt — including every skill file loaded via --skill>

## Response
<the answer>
```

The prompt section is large: attaching `finance/stocks` injects its whole
`SKILL.md`. So the UI must split on `## Response`. An earlier version split
on the first `---`, which landed on the skill's YAML frontmatter opener and
leaked the skill docs and the raw instructions into the reader's view —
visible only on scheduled runs, never on the manual button.

`ui_server/server.py::_extract_cron_response` handles this, falling back to
the `---` form used by `--no-agent` script jobs.

Filenames are `2026-08-25_08-04-03`, not `20260825_080403`;
`_cron_output_date` accepts both.

**`save_job_output` runs unconditionally, before delivery.** Switching
`--deliver` to LINE therefore does not stop the file being written, and the
UI keeps showing scheduled briefs.

## The prompt file is not the prompt

`config/daily-brief-prompt.txt` is the **source**, not what runs. The cron
job stores its own copy, taken when the job was created, in
`.hermes/cron/jobs.json`. Editing the file changes nothing about the next
run — and it fails silently, which is the dangerous part.

This bit once already: the 429 batching fix was written into the file on
2026-08-25 and the 2026-08-26 run still hit 429, because the job was still
executing its 779-character snapshot from creation day.

After editing the prompt, always run:

```bash
./scripts/sync-brief-prompt.sh
```

It pushes the file into the job and then re-reads `jobs.json` to confirm the
two match, rather than trusting the edit command's exit code.

## Yahoo Finance rate limits

The 2026-08-25 run reported 「本日は取得できませんでした」 for markets after
Yahoo returned HTTP 429. The agent had queried each symbol separately, and
Yahoo throttled the burst.

The skill's `quote` accepts many symbols in one invocation and paces the
requests internally — six symbols take about 60 seconds but all succeed. The
prompt now requires a single batched call, with one retry after 60s before
declaring failure.

Honest reporting worked correctly here: the brief said the data could not be
retrieved rather than inventing numbers.

## Build order

1. Create the job as a **manually triggerable** brief.
2. Run it by hand and check the content quality.
3. Verify a real push arrives in LINE (CRON-02).
4. Only then attach a recurring schedule.

## HUMAN ACTION REQUIRED — schedule

**Purpose:** set the recurring delivery time.

Not specified anywhere in the project material, so it is deliberately not
invented:

1. Delivery time (e.g. 07:00)
2. Timezone — presumably `Asia/Tokyo`, please confirm
3. Frequency — every day, or weekdays only

Once known:

```bash
./scripts/social-hermes config set timezone Asia/Tokyo
./scripts/social-hermes cron list
```

The Hermes timezone is currently unset (server-local).
