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

## 10. Google連携（スプレッドシート）

**2026-09-04 に「本番」へ公開済みです。** 認証は失効しません。

```bash
# 認証が生きているか
sudo -u social -H bash -lc 'cd ~/Social-ai && \
  HERMES_HOME=$HOME/Social-ai/.hermes \
  $HOME/.hermes/hermes-agent/venv/bin/python \
  .hermes/skills/productivity/google-workspace/scripts/setup.py --check-live'
```

`invalid_grant` が出たら再認証が必要です（`--auth-url` でURLを発行 →
ブラウザで承認 → 戻り先URL全体を `setup.py "<URL>"` に渡す）。

> **公開ステータスを「テスト中」に戻さないでください。**
> テスト中のアプリは、Googleが認証を **7日で強制失効**させます。
> 実際にこれで一度スプレッドシートが読めなくなりました。

権限は `spreadsheets.readonly` のみです。**書き込みはできません。**
読ませたいシートは `.hermes/SOUL.md` の「登録済みスプレッドシート」表に
ID を追記してください（Drive検索の権限は渡していないため、
登録していないシートは名前で探せません）。

---

## 11. 本番サーバー（ConoHa）

**移行は完了しています。**（2026-09-03）
本番はクライアント所有の ConoHa VPS で、`social` ユーザーが動かしています。

| 項目 | 値 |
|---|---|
| ホスト | `163.44.96.144` |
| 実行ユーザー | `social`（`root` ではありません） |
| プロジェクト | `/home/social/Social-ai` |

```bash
# 本番での操作は必ず social ユーザーで
sudo -u social -H bash -lc 'cd ~/Social-ai && ./scripts/health-check.sh'
```

> **`sudo -u social` に `-H` を必ず付けてください。**
> 付け忘れると `$HOME` が root のままになり、`HERMES_HOME` が
> 別の場所を指して「記憶がない」状態に見えます。

`systemctl --user` を root 経由で使うときは実行先を明示します。

```bash
sudo -u social -H XDG_RUNTIME_DIR=/run/user/$(id -u social) \
  systemctl --user status hermes-gateway social-ui social-tunnel --no-pager
```

`social` は **linger 有効**なので、ログアウト中もサービスは動き続け、
サーバー再起動後も自動で復帰します。

### 更新の流れ

```bash
# 手元で編集 → 本番へ反映
rsync -av --exclude .git --exclude node_modules --exclude .env \
  ~/Social-ai/ social@163.44.96.144:~/Social-ai/

sudo -u social -H bash -lc 'cd ~/Social-ai/ui && npm run build'
sudo -u social -H XDG_RUNTIME_DIR=/run/user/$(id -u social) \
  systemctl --user restart social-ui
```

> **`.env` は同期しないでください。** 本番の値が上書きされます。
> 秘密情報の変更は本番側で `./scripts/set-secret.sh` を使います。

### 開発VPSについて

移行時に、開発VPS側のサービスは**停止のうえ無効化済み**です。
再度有効にすると、**デイリーブリーフがLINEに二重配信**されます。
