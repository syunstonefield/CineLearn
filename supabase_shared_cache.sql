-- CineLearn — 共有単語キャッシュ ＋ 厳選カタログ スキーマ（Phase 0 / A：リーン版）
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- 関連: docs/shared-cache-design.md ／ supabase_schema.sql（既存・個人データ）
--
-- 設計の要点（2026-06-16 確定）:
--   * Phase 0 = A（リーン）。字幕全文 `subtitle_raw_cache` とサーバー生成は本ファイルに含めない
--     （経路②／フェーズ2 着手時に、本ファイルへ非干渉で追加する）。
--   * レベル別生成は「スーパーセット＋読み取り時絞り」方式（決定: い）。
--       - 1話につき広め（A2〜C2 を網羅）に 1 回だけ生成して `words`(jsonb) に保存。各語に level/tier を持つ。
--       - 学習者個人の TOEIC スコアはここに保存しない（個人データ＝ profiles 側）。
--       - 読み取り時にバンド絞り＋除外語＋語数キャップを当て込む（コストは 1 話 = 1 回のまま）。
--   * 書き込みは service_role 専用（シードスクリプト）。anon / authenticated は SELECT のみ。
--
-- ★重要（実機検証 2026-06-16）:
--   本番では anon にテーブル GRANT 自体が無い（未認証 SELECT が 401 permission denied / 42501）。
--   よって RLS ポリシーだけでは公開読みできない。anon / authenticated への GRANT SELECT を明示すること。

-- ── vocab_cache（生成済み単語スーパーセット／32条引用1文・配信OK・version 永続）──
CREATE TABLE IF NOT EXISTS vocab_cache (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key         text        UNIQUE NOT NULL,        -- 'v{n}:tmdb{id}:s{S}e{E}'（レベルはキーに含めない）
  cache_version     int         NOT NULL,               -- 生成ロジック(プロンプト/モデル)の版。上げると旧版は未ヒット化
  tmdb_id           int         NOT NULL,
  season            int         NOT NULL,
  episode           int         NOT NULL,
  display_title     text,                               -- 表示用の原題（任意）
  title_norm        text,                               -- 正規化タイトル（補助・デバッグ用。キーには使わない）
  words             jsonb       NOT NULL,               -- 単語スーパーセット（要素: word/level/pos/definition/example/example_ja/tier/source）
  word_count        int,                                -- words 件数（品質ゲート・監視用）
  coverage_min      text,                               -- スーパーセットがカバーする下限 CEFR（例 'A2'）
  coverage_max      text,                               -- 上限 CEFR（例 'C2'）
  subtitle_provider text,                               -- 出所（例 'opensubtitles'）＋必要なら file_id
  model             text,                               -- 生成モデル（例 'claude-haiku-4-5'）
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- 補助インデックス（cache_key 以外での照合・運用クエリ用）
CREATE INDEX IF NOT EXISTS vocab_cache_lookup
  ON vocab_cache (tmdb_id, season, episode, cache_version);

ALTER TABLE vocab_cache ENABLE ROW LEVEL SECURITY;
-- 公開読み（ログアウト含む全員）。GRANT が無いと RLS 以前に 401 になるため明示する。
GRANT SELECT ON vocab_cache TO anon, authenticated;
DROP POLICY IF EXISTS "vocab_cache public read" ON vocab_cache;
CREATE POLICY "vocab_cache public read"
  ON vocab_cache FOR SELECT TO anon, authenticated USING (true);
-- 書き込みは service_role のみ（service_role は RLS をバイパス。明示 GRANT で堅牢化）。
GRANT ALL ON vocab_cache TO service_role;

-- ── catalog（ホワイトリスト）──
CREATE TABLE IF NOT EXISTS catalog (
  tmdb_id       int         PRIMARY KEY,
  title_norm    text,
  display_title text,
  type          text        NOT NULL DEFAULT 'tv',      -- 'tv' | 'movie'
  enabled       bool        NOT NULL DEFAULT true,
  seasons       jsonb,                                  -- 対応シーズン/話数の指定（任意）
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE catalog ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON catalog TO anon, authenticated;
-- enabled な作品のみ公開（カタログ外＝「近日対応」表示の判定に使う）。
DROP POLICY IF EXISTS "catalog public read" ON catalog;
CREATE POLICY "catalog public read"
  ON catalog FOR SELECT TO anon, authenticated USING (enabled);
GRANT ALL ON catalog TO service_role;

-- ── 検証クエリ（実行後にダッシュボードで確認）──
--   SELECT relrowsecurity FROM pg_class WHERE relname IN ('vocab_cache','catalog'); -- 両方 t
--   匿名 anon での SELECT が 200 で空配列を返すこと（401 でないこと）を実機確認する。
