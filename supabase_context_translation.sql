-- CineLearn — 文脈つき語義キャッシュ（translation_ctx_cache）＋ my_words.ja 列
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- 関連: next-app/app/api/claude/route.js（mode:'wordsense'）／docs/design-context-translation.md
--
-- 役割:
--   ① translation_ctx_cache — 「この字幕文の中でのこの単語の意味」（Haiku生成）を
--      sense_hash（正規化した字幕文のハッシュ）キーで共有保存。同じ場面の同じ単語は
--      2人目以降 0 円・即時。word 単体キーの translation_cache（速報用）とは別物で、
--      同一エピソード内の同語多義（法廷ドラマの brief 等）の誤配布を構造的に防ぐ。
--   ② my_words.ja — 保存時にポップアップで見せた文脈訳を固定保存する列。
--      これが無いと単語帳が別の1語訳を取り直し、復習で誤訳を刷り込む
--      （ポップアップの訳と単語帳の訳が別物になる欠陥の修正）。
--
-- アクセス:
--   translation_ctx_cache は /api/claude(wordsense) が service_role で読み書きする専用
--   テーブル。anon / authenticated には GRANT を付けない（translation_cache と同じ方針）。
--   my_words は既存の RLS/GRANT（本人のみ）を踏襲＝列追加のみ。

-- ── ① translation_ctx_cache ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS translation_ctx_cache (
  word            text        NOT NULL,              -- 小文字正規化した原語
  target_lang     text        NOT NULL DEFAULT 'ja',
  sense_hash      text        NOT NULL,              -- 正規化字幕文の sha256 先頭16hex
  translated      text        NOT NULL,              -- その場面での語義（15字以内目安）
  sentence_sample text,                              -- デバッグ・監査用の字幕文サンプル（≤200字）
  tmdb_id         integer,                           -- 付帯メタ（主キーにしない・クリック時点で未解決のため）
  season          integer,
  episode         integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (word, target_lang, sense_hash)
);

ALTER TABLE translation_ctx_cache ENABLE ROW LEVEL SECURITY;

-- ★ anon / authenticated への GRANT は付与しない（route が service_role で読み書き）。
GRANT ALL ON translation_ctx_cache TO service_role;

-- ── ② my_words.ja 列追加 ─────────────────────────────────────────────────
-- 保存時の文脈訳を固定保存（definition=英英定義とは別の列。統合しない）。
ALTER TABLE my_words ADD COLUMN IF NOT EXISTS ja text;

-- ── 検証 ──
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'translation_ctx_cache'; -- t
--   SELECT column_name FROM information_schema.columns WHERE table_name='my_words' AND column_name='ja'; -- 1行
--   /api/claude に {mode:'wordsense', word, sentence} を2回投げ、2回目が via:'cache' で返ること。
