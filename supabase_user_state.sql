-- CineLearn — user_state（学習データの汎用 key-value 同期）
-- Supabase ダッシュボード > SQL Editor で実行してください
--
-- 目的: localStorage のみだった学習データ（半券/お気に入り/学習時間/予習完了/席番号）を
--       デバイス跨ぎで同期する。key は localStorage キーそのまま
--       （cl_tickets_{pid} / cl_fav_dramas_{pid} / cl_study_sec_{pid} /
--        cl_study_drama_{pid} / cl_prepped / cl_seat_counter）。
--       プロフィール別キーの {pid} は profiles テーブル同期で安定する前提。
-- マージはクライアント側（lib/supabase.js の pullFromCloud）で種類別に行い、
-- サーバーは素朴な last-write-wins の upsert のみ。

CREATE TABLE IF NOT EXISTS user_state (
  user_id    UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);
ALTER TABLE user_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own state" ON user_state
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
