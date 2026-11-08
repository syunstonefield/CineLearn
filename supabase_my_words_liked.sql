-- ♡（お気に入りの例文の印）の列を my_words に追加（オーナー決定 2026-11-07・法務 条件付きOK・③単語帳部門）
--   liked     … 語に付いた例文（既存の sentence）に ♡ を付けたか。文は書き換えない・新しい文は保存しない。
--   liked_at  … 付けた日（表示順用・YYYY-MM-DD）。
--   ♡は語に付ける印（語が見出し・例文は従）。利用者をまたいだ集計や共有キャッシュへの投入はしない。
--
-- 【適用】Supabase ダッシュボードの SQL Editor で実行する（in_wordbook と同じ手順）。単語帳の ♡ のデプロイと同時か直後。
-- 送信側（next-app/lib/supabase.js の pushMyWord）は列が無い間は liked / liked_at を外して再送するフォールバックを持つので、
-- この SQL の実行前でも同期は壊れない（♡がクラウドに残らないだけ・端末には残る）。
-- ⚠ in_wordbook の既定を false にする変更は別ファイル（supabase_my_words_wordbook_default.sql）＝拡張 v1.2.12 の公開に合わせて実行。
ALTER TABLE my_words ADD COLUMN IF NOT EXISTS liked boolean NOT NULL DEFAULT false;
ALTER TABLE my_words ADD COLUMN IF NOT EXISTS liked_at TEXT;

-- ── 検証 ──
-- SELECT column_name, column_default FROM information_schema.columns WHERE table_name='my_words' AND column_name IN ('liked','liked_at');
