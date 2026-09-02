# SOCIAL — 運用コマンド集

すべて `~/Social-ai` を起点に実行します。
Hermes を直接呼ばず、必ず `./scripts/social-hermes` を経由してください
（`HERMES_HOME` と `.env` を固定するラッパーです）。

---

## 1. まず現状を知る

```bash
cd ~/Social-ai
./scripts/health-check.sh
```

環境・秘密情報の有無・ファイル権限・稼働状況をまとめて確認します。
**値は一切表示しません**（設定済みかどうかだけ）。

```bash
# 3サービスの状態を一覧
systemctl --user status hermes-gateway social-tunnel social-ui --no-pager | grep -E "●|Active:"
```

---

## 2. 常駐サービス

SOCIAL は 3 つのサービスで動いています。すべて **systemd ユーザーサービス**で、
異常終了しても自動復帰し、サーバー再起動後も自動で立ち上がります。

| サービス | 役割 | ポート |
|---|---|---|
| `hermes-gateway` | AI本体・LINE受信・定時実行 | 8646（LINE） |
| `social-ui` | 専用UI | 9200 |
| `social-tunnel` | 公開（Cloudflare） | — |

```bash
# 起動 / 停止 / 再起動
systemctl --user start   <サービス名>
systemctl --user stop    <サービス名>
systemctl --user restart <サービス名>

# 3つまとめて再起動
systemctl --user restart hermes-gateway social-ui social-tunnel

# ログ（-f で追従）
journalctl --user -u hermes-gateway -n 50
journalctl --user -u social-ui -f
```

> **`./scripts/start-ui.sh` は手動起動用です。**
> 常用は `systemctl --user start social-ui` を使ってください。手動起動は
> 監視外なので、落ちるとそのままになります。

---

## 3. 動作確認

```bash
# 公開URL
curl -s -o /dev/null -w "UI   %{http_code}\n" https://social-ai01.com/login
curl -s -o /dev/null -w "LINE %{http_code}\n" https://line.social-ai01.com/line/webhook/health

# SOCIALに直接聞く（CLI）
./scripts/social-hermes -z "あなたの名前は？"

# 対話モード
./scripts/social-hermes chat
```

---

## 4. OpenAI の残高・キー確認

残高が尽きると**会話・音声・画像生成のすべてが停止**します。
専用UIの **MENU → CONNECTIONS** に状態が出ますが、コマンドでも確認できます。

```bash
cd ~/Social-ai
set -o allexport; source .env; set +o allexport
curl -s https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-nano","messages":[{"role":"user","content":"."}],"max_completion_tokens":16}' \
  | python3 -c "import json,sys;d=json.load(sys.stdin);e=d.get('error');print('NG:',e.get('code')) if e else print('OK')"
```

`credit_balance_exhausted` が出たらチャージが必要です。
https://platform.openai.com/settings/organization/billing

> **`/v1/models` では判定できません。** 残高ゼロでも 200 を返します。
> 実際に課金される呼び出しでしか分かりません。

---

## 5. 秘密情報の追加・変更

**エディタで `.env` を直接編集しないでください。** 専用コマンドがあります。

```bash
./scripts/set-secret.sh OPENAI_API_KEY        # 入力は非表示
./scripts/sync-env.sh                          # Hermes側へ反映
systemctl --user restart hermes-gateway social-ui
```

`set-secret.sh` は入力を伏せ、シェル履歴にも `ps` にも残さず、
書き込み後に**実際に読み込めるか検証**します。

---

## 6. デイリーブリーフ

```bash
./scripts/social-hermes cron list --all      # 状態確認
./scripts/social-hermes cron runs            # 実行履歴
./scripts/social-hermes cron pause  <ジョブID>
./scripts/social-hermes cron resume <ジョブID>
```

**プロンプトを変えたら必ず同期してください。**

```bash
vi config/daily-brief-prompt.txt
./scripts/sync-brief-prompt.sh
```

> cron ジョブは**作成時のプロンプトを自前で保持**しています。
> ファイルを編集しただけでは反映されず、しかも**エラーが出ません**。
> 実際にこれで修正が丸一日効かなかったことがあります。

---

## 7. UI の変更を反映する

```bash
cd ~/Social-ai/ui
npm run build
systemctl --user restart social-ui
```

アイコンを差し替えた場合は、`ui/public/sw.js` の `SHELL_CACHE` の
バージョンを上げてください。上げないと、インストール済みの端末で
古いアイコンが残り続けます。

---

## 8. バックアップ

```bash
./scripts/backup.sh          # 記憶・会話履歴・設定・スキルを丸ごと
```

出力には**秘密情報が含まれます**。共有ストレージに置かないでください。

---

## 9. 困ったときの順序

```bash
# 1. まず全体像
./scripts/health-check.sh

# 2. Hermes側の診断
./scripts/social-hermes doctor

# 3. どのサービスが落ちているか
systemctl --user status hermes-gateway social-ui social-tunnel --no-pager

# 4. 直近のエラー
journalctl --user -u hermes-gateway -n 80 --no-pager | grep -iE "error|fail"
```

| 症状 | 最初に見るところ |
|---|---|
| 返事が来ない（LINE・UI両方） | OpenAIの残高（上記4） |
| 専用URLが開かない | `social-ui` と `social-tunnel` |
| LINEだけ無反応 | `hermes-gateway` のログ |
| ブリーフが届かない | `cron runs` の実行履歴 |
| 記憶が消えた？ | `.hermes/memories/` の中身 |

---

## 10. 本番サーバーへの移行

まだ実施していません。手順は [MIGRATION.md](MIGRATION.md) にあります。

```bash
./scripts/migration-check.sh   # 移行可能な状態かを検査
```
