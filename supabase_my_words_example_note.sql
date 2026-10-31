-- my_words.example_note（2026-10-31・例文なしの自動補完）
--   例文の注記を持つ jsonb 列。2種類だけ:
--     { "kind": "ai", "en": "...", "ja": "..." }   … AI 作例（字幕の引用ではない。sentence 列には入れない）
--     { "kind": "other_scene", "of": "<例文の先頭40字>" } … 例文がこの回の別の場面の台詞（例文が差し替わったら無効）
--   アプリ（lib/supabase.js）は列が無い DB でも動く（PGRST204 で列を外して再送＝AI 作例はその端末だけに残る）。
--   拡張は列を送らない＝merge-duplicates で据え置かれる。拡張が後で本物の例文を入れると、表示は例文が優先される。
-- 【適用】Supabase ダッシュボードの SQL Editor で実行する（ts_sec / in_wordbook と同じ手順）。
--   my_words の GRANT は既存（supabase_user_state.sql）で列追加に追従する＝追加の GRANT は不要。

ALTER TABLE my_words ADD COLUMN IF NOT EXISTS example_note jsonb;

-- 確認
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'my_words' AND column_name = 'example_note';
