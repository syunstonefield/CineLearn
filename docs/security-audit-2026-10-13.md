# セキュリティ監査 2026-10-13（公開後・コード監査）

前提: 2026-10-11 に noindex 解除・Chrome Web Store 公開（拡張 v1.2.9）＝**公開中の実運用**として評価。
方法: `security` 部を攻撃面ごとに3インスタンス独立並列（A=API/認証/課金天井、B=Supabase RLS/GRANT/鍵、C=拡張/クライアント・相互非開示）→ メインが High 以上を実コードで裏取り → 収束。
対象: `next-app/app/api/*`（16ルート）・`next-app/lib/server/*`・SQL 13本・`extension/*`。作業ツリー＝dist v1.2.9 zip と content.js の未公開差分のみ。

## 結論
- **Critical なし。High 4件**（いずれも課金/枠の経済面か共有データの汚染。個人データの横断アクセスは不可）。
- 2026-06 監査の High 2件は閉鎖: 中継 catch-all は構造ごと廃止、拡張 XSS は `esc()` で全補間点を被覆（content.js:1781-1816 を1点ずつ確認）。
- 2026-06 の「RLS `WITH CHECK` 欠如」は**誤検知として撤回**（PostgreSQL 仕様: FOR ALL/UPDATE で WITH CHECK 省略時は USING 式が新規行判定にも使われる）。

## High（即対応）
### H1 共有訳キャッシュの汚染（プロンプト注入でキー衝突）— 確認済み
- `app/api/claude/route.js:27` `senseHash` は `[^a-z0-9]` を全て捨ててハッシュ → 日本語・記号を足した文が正規例文と**同じキー**。
- `:408`（sentence）/`:557`（sentences）はプロンプトに**原文をそのまま**埋める → 「正規例文＋日本語の指示」を送るとモデルが従い、結果が正規キーで `translation_ctx_cache` → `vocab_cache.example_ja`（`:600-603`→`patchVocabCacheExampleJa`）に書かれる。空欄のみ追記＝**恒久汚染**。
- 出力検証は `:588`「200字以内・日本語を含む」のみ。例文は `/api/vocab`（anon 読み）で列挙できるため標的選定が容易。wordsense も同構造。
- 修正: ハッシュ対象とモデルに渡す文字列を一致させる（非 ASCII/引用符を除去 or 拒否）。`vocab_cache` への追記は DB 行の example を原文に訳した結果だけに限る。

### H2 匿名で OpenSubtitles 日次 DL 枠（700）を焼却 — 確認済み
- `app/api/example/route.js:86-121`: Origin → IP 60/分 → **認証なし** → `tmdbId`/`season`/`episode` を body からそのまま採用（範囲チェック無し）→ `currentTimeSec` 付与で `:291` を抜け → raw 未取得なら `:299 fetchEpisodeSrt` が OS DL。カタログゲートはこの経路に無い（manual だけ人/日5話の締め）。
- 未取得の話を回すと IP 1つ・約12分で共有枠が尽き、その UTC 日は全員の生成・例文補完が `os_quota`。OS 枠は金で買えない資源。
- 修正: manual 以外の層2 DL は「vocab_cache 行がある話 or カタログ内作品」に限定＋example 用 DL 専用バケット（IP/日・failClosed）で生成分を予約。

### H3 Upstash fail-open の連鎖 — 確認済み（台帳既知#3を格上げ）
- 無料で Upstash コマンドを消費できる入口: `/api/vocab`（レート制限なしで毎回 `bumpStats` 書込・`vocab/route.js:44`）、`/api/usage`（端末番号自己申告・IP 制限なし・`usage/route.js:31-32`）。
- 枯渇/不通時: claude 全バケット素通し（`lib/ratelimit.js:109,112`）＋**OS 日次キャップも素通し**（`lib/server/opensubtitles.js:139` `Number(null)=0`）。vocab-generate だけ failClosed で 503。
- 修正: 課金系バケットと OS キャップは不通時に**拒否側**へ。制限の無いルートに IP 制限。EVAL で「上限未満のときだけ INCR」1往復化（DECR 不要・コマンド半減）。要確認: Upstash プラン（従量なら「枯渇」でなく「請求増幅」）。

### H4 Anthropic 支出の全体天井が無い — 運用（5分）
- 天井は IP ごとのみ（約 $2/日/IP・reco は title_search/resolve_titles のキーを変えればキャッシュ非命中）。被害は IP 数に比例。台帳の「公開拡大前に設定」は 10/11 に期限超過。
- 修正: Anthropic コンソールで月次上限 $30〜50 を**今**設定＋Haiku 呼び出しの全体日次上限（Upstash 計数・failClosed）。

## Medium
- **vocab_cache の anon 全件 SELECT**（`supabase_shared_cache.sql:46-52` `USING(true)`）: 公開 anon キーで REST 直読みすると `/api/vocab` の上限・カタログゲート・語数キャップを迂回して全作品の逐語例文＋example_ja を一括取得可。**32条の立て付けへの影響＝legal/オーナー判断**。修正は順序厳守: ①`lib/server/vocabCache.js` の `sbSelect` 既定ヘッダを service へ→デプロイ ②`REVOKE SELECT ON vocab_cache, catalog FROM anon, authenticated; DROP POLICY "vocab_cache public read"`。逆順だと `/api/vocab` が止まる。anon 読みはサーバ（vocabCache.js:41-50,68・health:49）のみ＝クライアント/拡張の直読みは無い。
- **SQL 再実行で plan の書込封鎖が外れる**（`supabase_user_state.sql:33` が profiles にテーブル単位 INSERT/UPDATE）: `profiles_plan.sql` の後に再実行すると自分の plan を 'plus' に書換え可。修正＝33行目を列単位付与（`profiles_plan.sql:28-32` と同形）。ファイル修正のみ・即対応。
- **profiles.id / history.id が全ユーザー共通 PK（Date.now()）**（`supabase_schema.sql:7,19`・`AppProvider.js:339`・`storage.js:808`）: 他人が後で使う id を先取りすると被害者の upsert が RLS で静かに失敗し、pull の全量上書きで手元からも消える（データ読取は不可）。修正＝`(user_id,id)` 複合 PK＋`crypto.randomUUID()`。次回 SQL で。
- **push-subscribe**（`push-subscribe/route.js:31-34,61`）: endpoint 無検証（cron が任意 URL へ POST・web-push もホスト非検証）・件数上限/レート制限なし・`:61` が PostgREST エラー本文をそのまま返す。直列送信（`push-notify/route.js:97-105`）が大量登録で時間切れ→正規通知停止。修正＝https＋既知プッシュサービスのホストのみ・1人あたり上限・定数エラー文言。
- **TMDB 呼び出し増幅**（`lib/server/tmdbResolve.js:9-24,54-75`・`example/route.js:103` title 長無制限）: 1リクエストで最大約140回 → TMDB 鍵停止で作品解決が全停止。修正＝候補4件・title 200字・結果（見つからずも）をキャッシュ。
- **拡張: セッションが content script に露出**（`background.js:174/202`・`bridge.js:36`・`content.js:780`）: `cl_sb_session`（access/refresh）が `chrome.storage.local`＝配信サイトのタブからも onChanged で読める。前提は配信サイトのレンダラ侵害＝敷居高。修正＝bridge→background へ sendMessage＋sender.origin 検証、access は storage.session。`setAccessLevel` の効き目は実機検証要。利用者拡大前に。
- **拡張: bridge の無検証転写**（`bridge.js:20-40`）: アプリ origin に XSS があれば攻撃者セッションを拡張へ植え込め、被害者の保存語・再会ログが攻撃者アカウントへ送られ続ける。修正＝形の検証（文字列/数値/UUID・サイズ上限）数行・即対応。本筋はアプリ側 CSP。

## Low（後回し可）
- `catalog-request/route.js:95` userKey 自己申告＝票の水増し／`push-notify/route.js:64` CRON_SECRET 比較が非定数時間（未設定時に素通りしない向きは正しい）／`example/route.js:113-114` S/E 範囲チェックなし／`/api/usage` データ汚染（端末番号自己申告）／`/api/gen-quota` が存在確認に words 全体を select（`gen-quota/route.js:34`→`select=cache_key`）／`lib/server/auth.js:63` invalid トークン非キャッシュ（gen-quota:36・vocab-generate:119・push-subscribe:38 がレート制限前に Auth を叩く）／`lib/server/tmdb.js:66,75` 404 ネガキャッシュなし／`origin.js:48-50` 拡張 ID enforce が warn-only（env 切替のみ）。
- 拡張: Netflix メタ偽装（`netflix-inject.js:124`・同一ページの任意スクリプトが `cl-netflix-meta` を偽装可・型/長さ無検証）＋恒久失敗の無限再送（`background.js:420-423,281-285`・4xx をキューに積み続ける）／`cl_vodsync_*` が読み手撤去後も無期限書込（`content.js:1541-1553`・10MB quota 枯渇で保存が黙って失敗）／manifest `https://*.supabase.co/*` は自ホストに絞れる・配信4サイトの host_permissions は background 未使用／background に sender/形の検証なし・uid を URL に未エンコード（`background.js:64,66,69,71,314`）／MutationObserver 非デバウンス（797-798）・Disney+ 150ms 全 DOM 走査（2757,2775-2788）・Amazon /dp/ 全ページでポーリング。
- Supabase: `catalog_request_ranking` ビューが所有者権限（`supabase_catalog_requests.sql:31-37`・今はデフォルト GRANT 無しで安全・`security_invoker=true` 推奨）／個人表の JSONB/text にサイズ上限なし（1アカウントで無料枠 500MB を埋められる）。

## 法務への申し送り（コードでない判断）
1. vocab_cache の anon 直読み（Medium 上記）が 32条の「必要最小限・主従」と整合するか。
2. `content.js:1676` のコメント「画面字幕は端末側に保存しない」に対し、実際は vodsync（1541-1553）とタイムライン（2070）が字幕本文を端末に保存している＝記述と実装の不一致。

## 問題なしと確認した領域
- 旧 root `api/`・catch-all 中継は不存在／claude 既定モード 400（`claude/route.js:611-614`）／subtitles search・download は seed 専用（`subtitles/route.js:85,101`）／空 Origin 拒否（`origin.js:38`）／vocab-contribute 不存在／push-subscribe は JWT から uid／seed・stats の秘密比較は sha256＋timingSafeEqual・空は拒否／health 無認証は `{ok,at}`／plan はベータ中・外部呼出なし／TMDB ID 整数強制／PostgREST 埋込は encodeURIComponent・整数・サーバ生成 hex・DB 由来 UUID のみ／429 時の DECR＋EXPIRE NX は正しく動作／vocab-generate のガード順序・SET NX ロック・publicReason／XFF は Vercel が上書き・本番に AAAA 無し（IPv6 回しは不可）。
- 個人データ: profiles/history/srs_data/my_words/user_state は自分の行のみ（他人 uid の INSERT/UPDATE/UPSERT/DELETE・自行 uid 書換は全て拒否）／push_subscriptions は GRANT 無し＋USING(false)／subtitle_raw_cache・translation_*・catalog_requests は anon/authenticated 不可（GRANT 無し＋ポリシー無し）／contributed_by は列 GRANT から除外／SECURITY DEFINER 関数なし／IDOR なし／anon JWT は全て role=anon（git 履歴含む）／service_role は env のみ（履歴はダミー値のみ）／`.env*` 未追跡・`NEXT_PUBLIC_` 使用ゼロ・クライアントに鍵名なし。
- 拡張: innerHTML 6箇所の外部由来補間は全て `esc()`（`& < > " '` を網羅）・属性値に信頼できない値なし・他は textContent／externally_connectable・onMessageExternal なし／トークンは Authorization ヘッダ・ログ出力なし／外部 fetch は HTTPS 固定＋encodeURIComponent／MV3 既定 CSP・options.html にインラインなし／web_accessible_resources は matches で限定／seek の postMessage はページ自身ができる操作のみ。

## 要追加検証（オーナー）
- 本番 DB の実適用状態: `pg_policies` / `information_schema.role_table_grants` / `column_privileges` / `pg_default_acl`（リポの SQL と一致するか。push_subscriptions への service_role GRANT はリポ内のどの SQL にも無いが本番で通知は配信済み＝リポ外適用の疑い）。
- Upstash のプラン（無料/従量）→ H3 の被害の形が変わる。
- Anthropic コンソールの月次上限の有無（H4）。
- 拡張 `storage.local.setAccessLevel` の実機挙動（C Med-1 の対策可否）。

## 対応の優先順（提案・最終判断はオーナー）
1. **今日**: H4 コンソール上限（5分）／H1 ハッシュ＝プロンプト一致＋追記の限定／H2 層2 DL の限定＋専用バケット／`supabase_user_state.sql:33` の列単位化／bridge.js の形検証。
2. **今週**: H3（課金系・OS キャップの fail-closed＋`/api/vocab`・`/api/usage` に IP 制限）／push-subscribe の endpoint 検証＋上限＋エラー定数化／tmdbResolve の候補上限＋キャッシュ。
3. **法務判断後**: vocab_cache の anon REVOKE（順序厳守）。
4. **次回 SQL・次版拡張**: PK 複合化／JSONB 上限／view security_invoker／拡張のセッション置き場・vodsync 撤去・manifest 絞り込み・メタ検証・再送の 4xx 破棄。
