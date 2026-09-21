# Google Tasks → MaxRecord bridge

Google Tasksの未完了タスクから、`マックス記録`で始まるものを毎分取得し、MaxRecordのFirestoreへ保存するCloudflare Workerです。保存成功時だけ元タスクを完了にします。

## 必要なWorker Secrets

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `FIREBASE_API_KEY`
- `ADMIN_TOKEN`

## 初回設定

1. Cloudflare KVを作成し、`wrangler.toml`のIDを置き換える。
2. 上記Secretsを登録してデプロイする。
3. Google CloudのOAuthリダイレクトURIへ `https://<worker>/oauth/callback` を登録する。
4. `https://<worker>/oauth/start` を一度開き、Google Tasksへのアクセスを許可する。
5. Cron Triggerが `* * * * *` になっていることを確認する。

解析失敗・回収対象不明の場合はMaxRecordへ保存せず、タスクを未完了で残します。`/status`で直近結果を確認できます。
