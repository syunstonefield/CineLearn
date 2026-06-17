-- CineLearn — 英日訳キャッシュ（translation_cache）
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- 関連: next-app/app/api/translate/route.js
--
-- 役割:
--   単語クリック時の英日訳（DeepL / Azure）の結果を単語キーで保存し、
--   同じ単語は2回目以降キャッシュから返す（無料枠・API コストを最小化）。
--   未適用でも /api/translate はライブ翻訳で動くが、毎回 API を叩く。
--
-- アクセス:
--   /api/translate が service_role で読み書きする専用テーブル。
--   外部公開する必要はないので anon / authenticated には GRANT を付けない。
--   （単語訳自体に著作権上の機微は無いが、配信面ではなくキャッシュなので非公開で十分。）

CREATE TABLE IF NOT EXISTS translation_cache (
  word        text        NOT NULL,                 -- 小文字正規化した原語
  target_lang text        NOT NULL DEFAULT 'ja',
  translated  text        NOT NULL,                  -- 訳文
  provider    text,                                  -- 'deepl' / 'azure' 等
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (word, target_lang)
);

ALTER TABLE translation_cache ENABLE ROW LEVEL SECURITY;

-- ★ anon / authenticated への GRANT は付与しない（route が service_role で読み書き）。
--   service_role は RLS をバイパスするが、明示 GRANT で堅牢化しておく。
GRANT ALL ON translation_cache TO service_role;

-- ── 検証 ──
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'translation_cache'; -- t
--   anon で SELECT が 401 になること（=非公開）を確認。
--   /api/translate に同じ単語を2回投げ、2回目が via:'cache' で返ることを確認。
