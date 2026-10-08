-- srs_data.origin_*（最初に出会った作品/話）列追加 ★視聴中の再会表示・2026-10-08
-- ✅本番適用済み（オーナー実行 2026-10-08）。履歴として残す（ts_sec / in_wordbook と同じ扱い）。
--
-- 【なぜ必要か】
-- 拡張が「他の作品で覚えた語」を字幕の中で示す（語彙リユニオンを視聴中に自然に起こす・オーナー決定）。
-- 復習で「覚えた」以上（repetitions >= 2・skipped=false）の語を対象にするが、srs_data には
-- 「どの作品のリストの語か」が無く、ホバーに「SUITS S1E3 で覚えた語」と出せない。
-- 復習カードは出所（_src）を持っているので、最初の採点時に固定して送る（以後は上書きしない）。
-- 既存行はアプリが予習履歴から一度だけ埋め戻す（lib/storage.js backfillSrsOrigins）。
--
-- 負荷: 通信回数は増えない（採点時の1行に列が3つ増えるだけ）。NULL 許容・既存行に影響なし。
--
-- 【適用】Supabase ダッシュボードの SQL Editor で実行する。
-- 送信側（next-app/lib/supabase.js pushSrsWords）は列が無い間は origin_* を外して再送する
-- フォールバックを持つので、この SQL の実行前でも復習の同期は壊れない（出所がクラウドに残らないだけ）。
ALTER TABLE srs_data ADD COLUMN IF NOT EXISTS origin_title   text;
ALTER TABLE srs_data ADD COLUMN IF NOT EXISTS origin_season  integer;
ALTER TABLE srs_data ADD COLUMN IF NOT EXISTS origin_episode integer;

-- ── 検証 ──
-- SELECT word, repetitions, origin_title, origin_season, origin_episode
--   FROM srs_data WHERE user_id = auth.uid() AND origin_title IS NOT NULL LIMIT 20;
