-- 公開拡大前の堅牢化（2026-09-12・design-B amendments A9 / A10）。Supabase SQL Editor でオーナーが実行する。
-- いずれも冪等。デプロイの前後どちらで実行してもアプリは壊れない（anon 読取は全て列指定 select のため）。

-- ─────────────────────────────────────────────────────────────────────────
-- 1) vocab_cache: 投稿元ハッシュ（contributed_by / contributed_at）を公開読みから外す（A9）
--    旧 contributed_by は固定ソルトの sha256 先頭16桁＝IPv4 総当りで復元可能で、テーブル単位の
--    GRANT SELECT により公開 anon キーで (IP, 作品, 話, 時刻) が読める状態だった。
--    列レベル GRANT に切り替える。/api/vocab・/api/example・/api/vocab-generate の anon 読取は
--    下記の列指定と一致（lib/server/vocabCache.js VOCAB_ROW_SELECT）。
--    新規行の contributed_by は HMAC-SHA256（鍵は env CL_HASH_PEPPER｜CL_SEED_SECRET）に変わっている。
-- ─────────────────────────────────────────────────────────────────────────
REVOKE SELECT ON vocab_cache FROM anon, authenticated;
GRANT SELECT (
  id,
  cache_key,
  cache_version,
  tmdb_id,
  season,
  episode,
  display_title,
  title_norm,
  words,
  word_count,
  coverage_min,
  coverage_max,
  subtitle_provider,
  model,
  created_at,
  updated_at
) ON vocab_cache TO anon, authenticated;

-- 旧ソルトで作られた投稿元ハッシュは復元可能なので消す（履歴は contributed_at だけ残す）。
UPDATE vocab_cache
   SET contributed_by = NULL
 WHERE contributed_by IS NOT NULL
   AND contributed_by NOT LIKE 'u:%'
   AND contributed_by NOT LIKE 'ip:%';

-- ─────────────────────────────────────────────────────────────────────────
-- 2) translation_ctx_cache: 配信画面の字幕行サンプルを消す（A10）
--    wordsense（拡張のクリック文脈訳）は Netflix/Amazon の画面字幕行を sentence_sample に保存していた。
--    PP「照合用の字幕行は応答の生成にのみ用い蓄積しない」と矛盾するため、コードは書かなくなり、
--    既存行も NULL にする。'__sentence__' 等（OpenSubtitles 由来の例文和訳）は対象外。
-- ─────────────────────────────────────────────────────────────────────────
UPDATE translation_ctx_cache
   SET sentence_sample = NULL
 WHERE sentence_sample IS NOT NULL
   AND word NOT LIKE '\_\_%';

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 確認クエリ（任意）
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT grantee, column_name FROM information_schema.column_privileges
--  WHERE table_name = 'vocab_cache' AND grantee IN ('anon','authenticated') ORDER BY 1,2;
-- SELECT count(*) FROM translation_ctx_cache WHERE sentence_sample IS NOT NULL AND word NOT LIKE '\_\_%';
