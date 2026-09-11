-- 共有単語キャッシュの投稿元記録（2026-09-12）。
-- /api/vocab-contribute が書く行に「投稿元 IP のハッシュ」と「投稿時刻」を残し、汚染が見つかったとき
-- 同じ投稿元の行だけを削除できるようにする（生 IP は保存しない）。
-- 列が無い間もルートは PGRST204 を検知して列なしで再送するので、実行の順序は問わない。
ALTER TABLE vocab_cache ADD COLUMN IF NOT EXISTS contributed_by text;        -- sha256('cl-contrib:'+IP) の先頭16hex
ALTER TABLE vocab_cache ADD COLUMN IF NOT EXISTS contributed_at timestamptz; -- 投稿時刻
CREATE INDEX IF NOT EXISTS vocab_cache_contributed_by ON vocab_cache (contributed_by);
-- 汚染時の掃除例（service_role・SQL Editor で）:
--   DELETE FROM vocab_cache WHERE contributed_by = '<hash>' AND subtitle_provider = 'opensubtitles(auto)';
