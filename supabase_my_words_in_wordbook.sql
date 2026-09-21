-- my_words.in_wordbook 列追加 ＋ ページネーション用索引（★単語帳メンバーシップ・2026-09-22）
--
-- 【なぜ必要か】
-- マイ単語帳を「紙の単語帳に付箋を貼る」感覚にする（オーナー判断 2026-09-22）。
--   ・単語リストの生成語にも ★ を付けて単語帳へ入れられるようにする
--   ・単語帳から外しても、視聴中に拾った語（拡張クリック保存・手動追加）は作品の単語リストに残す
-- 追加語は my_words にしか住んでいないため、行を消さずに「単語帳に入っているか」を持つ旗が要る。
--   in_wordbook = true  … 単語帳に表示する（既定・既存行はすべて true）
--   in_wordbook = false … 単語帳からは外したが、来歴（作品の単語リスト・遭遇ログ）は残す
--
-- あわせて、pull の固定天井（limit=2000）をページネーション（limit=1000&offset=N）に替えるので、
-- (user_id, created_at DESC) の索引を張る（既存の主キー (user_id, word) では順序付き走査が効かない）。
--
-- 【適用】Supabase ダッシュボードの SQL Editor で実行する（ts_sec と同じ手順）。
-- 送信側（next-app/lib/supabase.js の pushMyWord）は列が無い間は in_wordbook を外して再送する
-- フォールバックを持つので、この SQL の実行前でも同期は壊れない（★の外し状態はクラウドに残らないだけ）。
ALTER TABLE my_words ADD COLUMN IF NOT EXISTS in_wordbook boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS mywords_user_created ON my_words(user_id, created_at DESC);

-- ── 検証 ──
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name='my_words' AND column_name='in_wordbook';       -- 1行（default true）
--   SELECT indexname FROM pg_indexes WHERE tablename='my_words';       -- mywords_user_created を含む
--   -- アプリで単語帳から「★ 外す」したあと:
--   SELECT word, source, in_wordbook FROM my_words WHERE in_wordbook = false;
--
-- ※ RLS/GRANT は my_words の既存設定（"own words" ポリシー）をそのまま継承するため追加不要。
