# 共有単語キャッシュ シードスクリプト

`vocab_cache` / `catalog` に、厳選作品の生成済み単語（スーパーセット）を事前投入する。
設計: `../docs/shared-cache-design.md`（Phase 0 / A：リーン版）。

## 仕組み
- 生成ロジックは `next-app/lib`（`generateSuperset` / `fillMissingExampleJa` / `parseSrt` 等）を**そのまま再利用**（プロンプト・整形のドリフト防止）。
- 字幕取得と Claude 生成は**本番 Vercel Functions**（`/api/subtitles`・`/api/claude`）を `Origin` 付きで叩く（`api/_origin.js` のゲートを通す）。本番の OpenSubtitles クォータと Anthropic キーを使う。
- 書き込みは **service_role**（RLS バイパス）で `vocab_cache` / `catalog` に upsert。

## 前提
1. `supabase_shared_cache.sql` を Supabase の SQL Editor で**適用済み**であること。
2. Supabase の **service_role キー**（ダッシュボード > Project Settings > API）。**コミット禁止**。

## 実行
1. 初回のみ `seed/.env`（gitignore 済み）の `SUPABASE_SERVICE_ROLE_KEY` を自分の値に差し替える。
2. リポジトリ直下で：
```sh
node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/seed-vocab.mjs
```
- `--env-file=seed/.env`：鍵と API ベースをファイルから読む（毎回貼らなくてよい）。
- `--import ./seed/register-hooks.mjs`：必須（`next-app/lib` の拡張子なし import を素の Node で解決）。
- 任意 env（`seed/.env` に足せる）: `SUPABASE_URL`（既定=本番）、`VOCAB_CACHE_VERSION`（既定=1。**本番は 2**＝Vercel の `VOCAB_CACHE_VERSION` と必ず一致させる。2026-07-08 のシードは未設定＝1 で書かれ、本番 v2 から一切配信されていなかった。2026-09-11 に `seed/.env` へ `VOCAB_CACHE_VERSION=2` を固定）。

> env をコマンドに直書きする旧来の形も可：
> `SUPABASE_SERVICE_ROLE_KEY='…' CINELEARN_API_BASE='https://cine-learn.vercel.app' CINELEARN_API_ORIGIN='https://cine-learn.vercel.app' node --import ./seed/register-hooks.mjs seed/seed-vocab.mjs`

## 対象の追加
`seed/seed-vocab.mjs` の `TARGETS` を編集（`episodes` を増やす／作品を足す）。
クォータ（ログイン20件/日・VIP1000件/日）を超えない範囲で。

## 版の昇格（生成せずに旧版の行を新版キーへ複写）
版を間違えて書いた行や、プロンプトを変えずに版だけ上げた場合は、再生成せず `seed/promote-cache-version.mjs` で複写できる（Claude / OpenSubtitles 消費ゼロ・既存の新版行は上書きしない）。
```sh
node --env-file=seed/.env seed/promote-cache-version.mjs            # dry-run
node --env-file=seed/.env seed/promote-cache-version.mjs --apply    # 実書き込み（--from=1 --to=2 --since=2026-07-08 が既定）
```

## 注意
- `cache_version` を上げると旧行は `api/vocab` から参照されなくなる（再シードで作り直し）。
- 品質ゲート: 語数 < 20 は書き込まない（`MIN_WORDS`）。
