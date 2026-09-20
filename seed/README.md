# 共有単語キャッシュ シードスクリプト

`vocab_cache` / `catalog` に、厳選作品の生成済み単語（スーパーセット）を事前投入する。
設計: `../docs/shared-cache-design.md`（Phase 0 / A：リーン版）。2026-09-12（公開拡大前ブロッカー B・design-B §5 / A14）に経路を **`POST /api/vocab-generate` 1回** へ一本化した。

## 仕組み
- 単語生成は**本番の `POST /api/vocab-generate`** を `x-cinelearn-seed` ヘッダ付きで叩く（1話1回）。字幕取得→解析→Haiku→tsSec 付与→品質/coverage ゲート→`vocab_cache` 書込 まで**サーバ内で完結**し、seed には words（語＋例文1文＋tsSec）だけが返る。生 SRT・整形本文は seed に降りてこない（30条の4 の内部解析はサーバ内で閉じる）。
- 例文和訳は `next-app/lib/vocab.js` の `fillMissingExampleJa`（`/api/claude mode:'sentences'`＝共有キャッシュ経由）を**そのまま再利用**し、seed 自身も行の空欄 `example_ja` を PATCH（空欄しか触らない＝サーバの後埋めと競合しない）。
- 生 SRT が要るスクリプト（backfill/verify-timestamps・backfill-raw-cache）は `seed/lib/osdl.mjs` 経由: `subtitle_raw_cache`（service_role）を先に読み、無ければ本番 `/api/subtitles`（`action:'download'` は seed 秘密ヘッダ必須）。
- 書き込み（catalog の `enabled:true` 昇格・空欄 PATCH・raw cache 投入）は **service_role**（RLS バイパス）。

## 前提
1. `supabase_shared_cache.sql`・`supabase_subtitle_raw_cache.sql` を Supabase の SQL Editor で**適用済み**であること。
2. Supabase の **service_role キー**（ダッシュボード > Project Settings > API）。**コミット禁止**。
3. Vercel（cinelearn-next）の env `CL_SEED_SECRET` と同じ値を `seed/.env` に持つこと（seed はカタログゲート・レート制限が免除される。値は生成・報告のみ＝この README には書かない）。

## 必要 env（`seed/.env`・gitignore 済み）
| 名前 | 値 | 用途 |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 自分の service_role キー | 書き込み・`subtitle_raw_cache` の読み |
| `CINELEARN_API_BASE` | `https://cinelearn-next.vercel.app` | 本番 API（旧 `cine-learn` は 307 転送殻＝使わない） |
| `CINELEARN_API_ORIGIN` | `https://cinelearn-next.vercel.app` | 本番 API の Origin ゲート用（`Origin`/`Referer` に付く） |
| `CL_SEED_SECRET` | Vercel と同じ値 | `x-cinelearn-seed` ヘッダ。**base のホストが `cinelearn-next.vercel.app` 以外なら付けない**（別ホストへ秘密を流さない） |
| `VOCAB_CACHE_VERSION` | `2`（本番と一致） | `cache_key` の `v{n}`。2026-07-08 のシードは未設定＝1 で書かれ本番 v2 から配信されなかった＝必ず一致させる |
| `SUPABASE_URL`（任意） | 既定=本番 | |

## 実行（すべてリポジトリ直下・`--import ./seed/register-hooks.mjs` は `next-app/lib` の拡張子なし import を素の Node で解決するため必須）
```sh
# 単語シード（TARGETS の各話を /api/vocab-generate で生成 → 和訳 → catalog 昇格）
node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/seed-vocab.mjs
SEED_MAX_EPISODES=3 node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/seed-vocab.mjs   # パイロット（3話で停止）

# 例文和訳の後追い（'sentences' の枠 100/時 に当たって空欄が残ったとき）
node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-example-ja.mjs           # dry-run
node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-example-ja.mjs --apply   # 実行

# 📍時刻の検証（読取専用）／付け直し（既存行の tsSec だけ更新）
node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/verify-timestamps.mjs
node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-timestamps.mjs

# seed 済み行への生 SRT 後追い投入（/api/example manual・📍修復が raw を要るため）。OS の DL 枠を消費＝オーナー判断
node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-raw-cache.mjs                     # dry-run（OS を叩かない）
node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-raw-cache.mjs --apply --max=10    # 実行（--tmdb=<id> --min-fit=0.5 も可）

# 版の昇格（生成せずに旧版の行を新版キーへ複写・Claude / OpenSubtitles 消費ゼロ）
node --env-file=seed/.env seed/promote-cache-version.mjs            # dry-run
node --env-file=seed/.env seed/promote-cache-version.mjs --apply    # 実書き込み（--from=1 --to=2 --since=2026-07-08 が既定）
```

## seed-vocab.mjs の挙動（2026-09-12〜）
- 既に `vocab_cache` に行がある話はスキップ（生成・クォータ消費なし）。
- 応答の分岐: `hit`（他経路で生成済み）／`generated`／`nosub`（字幕なし・スキップ）／`nogen`（直近の失敗が記憶されている・最長1時間後に再実行）／`meta.contributed===false`（品質・coverage ゲート不通過＝行は書かれない。catalog 昇格も見送り）。
- 再試行: `409 busy`（同じ話を他で生成中）は `retryAfterSec` 待ち（合計 300 秒まで）／`502`・`503`・`504`・通信断は 60 秒後に最大 2 回。話単位でログを残して次へ。
- 走査を止める失敗: `403`（Origin/秘密ヘッダ）・`429`（seed は免除のはず＝秘密ヘッダが効いていない）・`404`（ルート未デプロイ）・`os_quota`（OpenSubtitles の日次 DL 枠）・base の 3xx 転送。
- 1話の生成は最長 240 秒（サーバの予算）。

## 対象の追加
`seed/seed-vocab.mjs` の `TARGETS` を編集（`episodes` を増やす／作品を足す）。
週 30 話・単一作品を短期集中で埋めない（`docs/design-curated-catalog.md` §5）。OpenSubtitles の DL 枠（共有・日次）を超えない範囲で。

## 注意
- `cache_version` を上げると旧行は `/api/vocab` から参照されなくなる（再シードで作り直し）。
- 品質ゲート（clean ≥ 20 語・drama ≥ 5 語・coverage）は**サーバ側**（`lib/server/vocabGen.js`）。seed 側に複製は無い。
- `subtitle_raw_cache` は TTL 30 日・非配信（anon GRANT 無し）。seed からも本文をログに出さない。
- `seed/.env` は gitignore 済み。鍵・秘密値は絶対にコミットしない・出力しない。
