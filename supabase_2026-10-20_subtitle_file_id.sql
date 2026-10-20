-- vocab_cache に「リスト生成に使った字幕ファイル」を記録する列を足す（2026-10-20 /decide D・G 第1段の土台）。
-- 正典: docs/decision-manual-example-matching-2026-10-20.md
--
-- 目的: subtitle_raw_cache（生字幕・30日 TTL）が消えた後に手動追加で字幕を取り直すと、OpenSubtitles を
--   検索し直して「その時点で人気のファイル」を選ぶため、リストを作った時と別の書き起こしで例文を探すことがある。
--   生成時のファイル番号を残し、取り直しは同じファイルを直接ダウンロードする（検索し直さない）。
--   記録するのはファイル番号（公開 ID）だけで、字幕の中身は保存しない＝30日 TTL の内部解析の線は変わらない。
--
-- 冪等。アプリはこの列が無くても動く（書込は列なしで再送・読みは失敗を「記録なし」扱い）。
-- 権限: anon / authenticated には GRANT しない（2026-10-15 に vocab_cache の SELECT を REVOKE 済み。
--   サーバは service_role で読む）。下の確認クエリで、anon / authenticated の行が出ないことを確かめる。

ALTER TABLE vocab_cache ADD COLUMN IF NOT EXISTS subtitle_file_id bigint;
ALTER TABLE vocab_cache ADD COLUMN IF NOT EXISTS episode_match text;
-- 'exact'＝話数が一致したファイル / 'unknown'＝ファイル側に話数の情報が無い / 'fallback'＝別の話数のファイル
--   NULL＝記録なし（この列を足す前の行・生成が raw cache に当たった行）
ALTER TABLE vocab_cache DROP CONSTRAINT IF EXISTS vocab_cache_episode_match_check;
ALTER TABLE vocab_cache ADD CONSTRAINT vocab_cache_episode_match_check
  CHECK (episode_match IS NULL OR episode_match IN ('exact', 'unknown', 'fallback'));

-- PostgREST に新しい列を知らせる
NOTIFY pgrst, 'reload schema';

-- 確認1: 列ができた
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'vocab_cache' AND column_name IN ('subtitle_file_id', 'episode_match');
-- 確認2: anon / authenticated が新しい列を読めない（0行なら正しい）
-- SELECT grantee, column_name FROM information_schema.column_privileges
--  WHERE table_name = 'vocab_cache' AND column_name IN ('subtitle_file_id', 'episode_match')
--    AND grantee IN ('anon', 'authenticated');
