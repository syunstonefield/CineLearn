-- CineLearn — 生字幕キャッシュ（subtitle_raw_cache）／経路②→①畳み込み 増分2
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- 関連: docs/route-fold-in-design.md ／ supabase_shared_cache.sql（vocab_cache/catalog）
--
-- 役割（クリック保存の例文補完・層2）:
--   拡張のクリック保存で「クリック語を含む OpenSubtitles の1文」を引くために、
--   生 SRT をサーバー側に一時キャッシュする。非 vocab_cache 語のフォールバック専用。
--
-- 法的位置づけ（public-launch-legal-posture と整合）:
--   * 生 SRT 全文 = 第30条の4（情報解析の内部入力）。**配信・再配布しない**。
--   * クライアントへ返すのは特定した「1文」だけ（第32条 引用）。本テーブルの行そのものは返さない。
--   * よって anon / authenticated には GRANT を与えない（service_role 専用＝外部から読めない）。
--   * TTL 必須（expires_at）。字幕ライブラリ化させない・目的拘束（解析キャッシュ）。
--
-- キー: 'tmdb{id}:s{S}e{E}'（生成版に依存しないので vocab のような version は付けない。映画は s0e0）。

CREATE TABLE IF NOT EXISTS subtitle_raw_cache (
  cache_key   text        PRIMARY KEY,            -- 'tmdb{id}:s{S}e{E}'
  tmdb_id     int         NOT NULL,
  season      int         NOT NULL,               -- 映画は 0
  episode     int         NOT NULL,               -- 映画は 0
  raw         text        NOT NULL,               -- 生 SRT（30条の4・内部解析入力・非配信）
  provider    text        DEFAULT 'opensubtitles',
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '30 days')  -- TTL（失効後は読取側で無視）
);

ALTER TABLE subtitle_raw_cache ENABLE ROW LEVEL SECURITY;

-- ★ anon / authenticated への GRANT は意図的に付与しない（非配信＝外部から読めない）。
--   service_role は RLS をバイパスするが、明示 GRANT で堅牢化しておく。
GRANT ALL ON subtitle_raw_cache TO service_role;

-- 失効行の物理削除（任意・運用クエリ）。pg_cron があれば定期実行、無ければ手動 or 読取側の論理失効に任せる。
--   DELETE FROM subtitle_raw_cache WHERE expires_at < now();

-- ── 検証 ──
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'subtitle_raw_cache'; -- t
--   匿名 anon での SELECT が 401（permission denied）になること（=非配信が効いている）を実機確認する。
