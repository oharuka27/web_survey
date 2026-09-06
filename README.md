# くらしのアンケート — Cloudflare Workers + D1

QRコードからスマホで回答し、4問の集計を円グラフで表示するWebアプリです。
画面はWorkers Static Assets、APIはWorkers、回答保存はD1を使用します。R2やGitHub Pagesは不要です。

## ローカル起動

Node.js 22.13以上（24推奨）で実行してください。

```sh
npm ci
npm start
```

ローカルD1にマイグレーションを適用して起動します。Cloudflareへのログインは不要です。

- 集計画面: http://localhost:3000
- 回答画面: http://localhost:3000/vote
- ローカルの回答保存先: `.wrangler/state/`（本番D1とは別）

スマホでローカル確認する場合は `npm run dev -- --ip 0.0.0.0` で起動し、PCと同じWi-Fiのスマホから接続できるPCのIPアドレスで集計画面を開いてください。QRコードは開いたURLのオリジンを使います。`localhost` で開いたQRはスマホには使えません。

## Cloudflareへの初回デプロイ

1. Cloudflareアカウントにログインし、D1を作成します。

   ```sh
   npx wrangler login
   npx wrangler d1 create web-survey-db
   ```

2. `wrangler.jsonc` の `database_id`（初期値はゼロのUUID）を、作成結果の実際のIDに置き換えます。`binding` は `DB` のままにします。CLIから設定の自動更新を提案された場合は、既存のDB設定を更新し、重複した設定がないことを確認してください。

3. 本番テーブルを作成してデプロイします。

   ```sh
   npm run db:migrate:remote
   npm run deploy
   ```

4. 表示された `https://web-survey.<サブドメイン>.workers.dev` を開きます。回答画面は `/vote` です。QRコードには公開URLが自動で入ります。

必要に応じて `wrangler.jsonc` の `name` を変更できます。独自ドメインで開いた場合は、そのドメインの回答URLがQRに入ります。リンクを特定ドメインに固定する場合のみ `vars` に `PUBLIC_URL` を設定してください。

```json
"vars": { "PUBLIC_URL": "https://survey.example.com" }
```

## GitHub連携による自動デプロイ

初回のD1作成・ID設定・本番マイグレーションを済ませてから、コードをGitHubへpushし、CloudflareのWorkers & PagesからGitリポジトリを接続します。

- プロジェクト種別: Workers
- Worker名: `web-survey`（`wrangler.jsonc` の `name` と一致させる）
- ルートディレクトリ: リポジトリのルート
- ビルドコマンド: `npm run build`
- デプロイコマンド: `npm run deploy`

`npm run build` はバンドルの検証だけを行い、本番への書き込みはしません。スキーマ変更を追加した場合は、公開前に `npm run db:migrate:remote` を実行してください。本番D1を共有するプレビュー環境では回答も本番へ入るため、プレビューが必要な場合は別のD1を設定してください。

## 仕様

- 住みたい府県：滋賀県、京都府、大阪府、兵庫県、奈良県、和歌山県、三重県
- 世帯構成：1人、2人、3人、4人、それ以上
- 子供：いる、いない
- 自家用車：ある、なし
- 全問必須・各問1つ選択。円グラフは3秒ごとに更新。
- D1上で集計し、個々の回答や送信トークンはAPIで公開しません。
- 同じブラウザーでは回答済み状態を保持し、同一トークンの再送は重複集計しません。本人認証はないため、別ブラウザーからの再回答を防ぐものではありません。
- 集計画面はアクセスできる全員に公開されます。
- 旧Node.js版の `data/survey.sqlite` は自動移行されません。既存ファイルはそのまま保持され、新しいD1は0件から開始します。

## 検証

```sh
npm test
npm run build
```

テストは一時領域にローカルD1を作成し、Workers実行環境で回答検証・重複防止・集計・永続保存・QR生成・画面配信を確認します。本番D1には接続しません。

## 公式ドキュメント

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/)
- [D1マイグレーション](https://developers.cloudflare.com/d1/reference/migrations/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
