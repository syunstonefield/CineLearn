-- my_words に CEFR の目安の「写し」列を追加（単語帳の CEFR 目安・2026-10-30・法務 条件1 写し方式）
--
-- 【なぜ必要か】
-- 単語帳の各語にも単語リストと同じ CEFR の目安（「B2」など）を出す。法務の条件は「保存するとき、その話の単語リストに
-- 同じ語があれば、表示していた段階（表 levelShown）と AI の段階を語の記録に写す。単語帳は保存された値だけを出し、
-- 表を引き直さない」。my_words は pull で端末を丸ごと上書きするため、値を残すには列が要る。
--   level        … 保存時に単語リストが持っていた AI の段階（'A1'〜'C2'）
--   level_shown  … 同・表（CEFR-J / Octanove）の段階。字幕の語で表に載っていた語だけ（おすすめ語・リストに無い語は NULL）
--   list_source  … ★で入れた語の元（'drama'＝字幕の語 / 'plus'＝おすすめ語）。source は 'star' になるので別に残す
-- 値は単語リスト生成の応答（/api/vocab-generate）に付いていたものの写しだけ。端末から送った語を表で引く経路は無い。
--
-- 【適用】Supabase ダッシュボードの SQL Editor で実行する（in_wordbook と同じ手順）。
-- 送信側（next-app/lib/supabase.js の pushMyWord）は列が無い間はこの3列を外して再送するフォールバックを持つので、
-- この SQL の実行前でも同期は壊れない（写しがクラウドに残らないだけ・端末には残る）。
ALTER TABLE my_words ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE my_words ADD COLUMN IF NOT EXISTS level_shown TEXT;
ALTER TABLE my_words ADD COLUMN IF NOT EXISTS list_source TEXT;

-- ── 検証 ──
-- SELECT word, level, level_shown, list_source FROM my_words WHERE level_shown IS NOT NULL LIMIT 10;
