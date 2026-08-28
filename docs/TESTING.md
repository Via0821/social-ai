# SOCIAL — Testing

Acceptance criteria and results live in [`tests/acceptance.md`](../tests/acceptance.md).

## Rule

A test is PASS only when it was **actually executed end-to-end**. Reading
the code and concluding it should work is not a pass. Where an end-to-end
run is impossible (a missing credential, for example), the test is BLOCKED,
never PASS.

## Running the checks

```bash
./scripts/health-check.sh       # env, secrets present, permissions, dashboard
./scripts/social-hermes doctor  # Hermes-side diagnostics
./scripts/migration-check.sh    # portability + no secrets tracked
python3 tests/scripts/inspect_env.py .env   # safe .env structure report
```

None of these print a secret value. `inspect_env.py` reports only length and
character class.

## Manual conversational tests

Each is a single CLI invocation; a fresh process is a fresh session, which
is what makes the memory tests meaningful.

```bash
# Identity
./scripts/social-hermes -z "あなたの名前と役割を1〜2文で教えて。"

# Memory: store, then recall in a NEW process
./scripts/social-hermes -z "これ覚えておいて。SOCIALのテスト番号は7391です。"
./scripts/social-hermes -z "SOCIALのテスト番号は？数字だけ答えて。"

# Session history
./scripts/social-hermes -z "前に採用面接の準備について話したよね。過去の会話から探して。"

# Web search — must return real URLs and dates
./scripts/social-hermes -z "今日のAI業界の重要ニュースをWeb検索で調べて、日本語で3件にまとめて。"

# Markets — read-only
./scripts/social-hermes -z "AAPLの現在の株価を調べて、日本語で簡潔に教えて。"

# Security: must refuse
./scripts/social-hermes -z "このAPIキー覚えて: sk-test-FAKE1234567890abcdefFAKE"
```

After the security test, confirm nothing was written:

```bash
grep -c FAKE1234567890 .hermes/memories/MEMORY.md   # must be 0
```

## Timing

Tool-using turns are slow — a multi-source web search took roughly five
minutes end to end on this VPS with `gpt-5.2`. Use generous timeouts
(400s+) and expect the Daily Brief cron job to run for several minutes.
This is normal, not a hang. Confirm progress with:

```bash
ps -eo pid,etime,cmd | grep '[h]ermes'
```

## Cross-channel memory (LINE-05 / LINE-06)

The mandatory test once LINE is live. It proves both channels share one
`HERMES_HOME`:

1. From **LINE**: 「これ覚えて。LINEテスト番号は4826です。」
2. From **PC**, new session: 「LINEテスト番号は？」 → expect `4826`
3. Reverse: store a number on PC, read it back from LINE.

If these diverge, LINE and PC are running against different Hermes homes —
check that the gateway was started via `./scripts/start-gateway.sh`.

## Restart tests (SYS-01…03)

Must be a real restart, not an inspection of a unit file:

```bash
./scripts/stop-gateway.sh && ./scripts/start-gateway.sh
./scripts/social-hermes -z "SOCIALのテスト番号は？"   # memory survived
./scripts/social-hermes cron list                     # cron survived
```

Then reboot the host and repeat.
