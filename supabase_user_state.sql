-- CineLearn — user_state 作成＋個人テーブルの GRANT 修復（2026-07-02）
-- Supabase ダッシュボード > SQL Editor で全文を一度に実行してください
--
-- 背景: この DB はテーブルへのロール権限（GRANT）がデフォルト付与されておらず、
--   RLS ポリシーがあっても 42501 permission denied になる（srs_data で実測・
--   vocab_cache 設計時にも同じ教訓あり）。RLS が「どの行か」を絞り、GRANT は
--   「テーブルを触れるか」の解錠。両方必要。anon には付与しない（個人データ）。

-- ── 1) user_state（学習データの汎用 key-value 同期）─────────────────────────
-- localStorage のみだった学習データ（半券/お気に入り/学習時間/予習完了/席番号）を
-- デバイス跨ぎで同期する。key は localStorage キーそのまま
-- （cl_tickets_{pid} / cl_fav_dramas_{pid} / cl_study_sec_{pid} /
--  cl_study_drama_{pid} / cl_prepped / cl_seat_counter）。
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
DROP POLICY IF EXISTS "own state" ON user_state;
CREATE POLICY "own state" ON user_state
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 2) GRANT 修復（authenticated=アプリのログインユーザー / service_role=サーバー）──
-- srs_data: 復習同期(authenticated)＋朝の通知クエリ(service_role)が読めず 42501 だった
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_state TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.srs_data   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.history    TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.my_words   TO authenticated, service_role;

-- ── 3) 旧 VAPID 鍵の購読を掃除（2026-07-02 鍵ペア再生成により送信不能な死骸）────
DELETE FROM public.push_subscriptions;
