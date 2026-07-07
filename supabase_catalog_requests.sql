-- CineLearn — 作品リクエスト（catalog_requests）
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- 関連: next-app/app/api/catalog-request/route.js ／ docs/design-curated-catalog.md §3
--
-- 役割:
--   カタログ外作品への「リクエスト受付中」の投票を保存する。
--   1端末（user_key）1作品1票（PKで重複投票を防止）。票数はカタログ追加の
--   優先順位決定（需要シグナル）と「〇〇票」表示に使う。
--
-- アクセス:
--   読み書きとも /api/catalog-request が service_role で行う専用テーブル。
--   anon / authenticated には GRANT を付けない（票の直接操作・列挙を防ぐ）。
--
-- 「対応予定」の表現について（スキーマ追加なしの規約）:
--   catalog テーブルに enabled=false で行を入れておくと「対応予定」とみなす
--   （enabled=true になった時点でカタログ入り＝RLSで公開される既存設計を流用）。

CREATE TABLE IF NOT EXISTS catalog_requests (
  tmdb_id    int         NOT NULL,
  user_key   text        NOT NULL,              -- 端末キー（ログイン時はユーザーID）
  title      text,                              -- 表示タイトル（集計時の可読性用）
  type       text        DEFAULT 'tv',          -- 'tv' | 'movie'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tmdb_id, user_key)
);

ALTER TABLE catalog_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON catalog_requests TO service_role;

-- ── 運営用の集計ビュー（Supabaseダッシュボードで見る・週次のカタログ追加判断）──
CREATE OR REPLACE VIEW catalog_request_ranking AS
  SELECT tmdb_id, max(title) AS title, max(type) AS type,
         count(*) AS votes, max(created_at) AS last_requested_at
  FROM catalog_requests
  GROUP BY tmdb_id
  ORDER BY votes DESC, last_requested_at DESC;
GRANT SELECT ON catalog_request_ranking TO service_role;

-- ── 検証 ──
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'catalog_requests'; -- t
--   /api/catalog-request に {action:'request', tmdbId, title} を2回投げ、
--   votes が1のまま増えないこと（同一端末の重複投票防止）を確認。
