-- CineLearn — profiles.plan（無料/プラスの判定の土台・2026-10-08）
-- Supabase ダッシュボード > SQL Editor で全文を一度に実行してください（オーナー実行）。冪等。
--
-- 背景: design-paid-features-2026-10-08「実装メモ 0. 土台: isPro」。
--   ベータ中はサーバーの env CL_PLAN_MODE 未設定＝全員 isPro:true で、この列は読まれない。
--   正式版（CL_PLAN_MODE=release）で next-app/lib/server/plan.js が service_role で読む。
--   実行はデプロイの前後どちらでもよい（ベータ中のアプリはこの列に触れない）。
--
-- ★安全上の要点: profiles は RLS「own profiles」（自分の行は FOR ALL）＋ テーブル単位の
--   GRANT INSERT/UPDATE（supabase_user_state.sql）なので、そのままだとログインユーザーが
--   公開 anon キー＋自分の JWT で plan='plus' に書き換えられる。
--   → authenticated の INSERT/UPDATE を列レベル GRANT に切り替え、plan を外す。
--   クライアントの pushProfiles（lib/supabase.js）が送る列は id,user_id,name,color,settings,updated_at だけなので影響なし。
--   plan を書けるのは service_role（将来の決済処理）だけ。

-- ── 1) 列の追加（既存行は 'free'）────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_plan_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check CHECK (plan IN ('free', 'plus'));
  END IF;
END $$;

-- ── 2) 書き込み権限を列レベルに（plan はクライアントから書かせない）──────────────
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT INSERT (id, user_id, name, color, settings, updated_at) ON public.profiles TO authenticated;
GRANT UPDATE (id, user_id, name, color, settings, updated_at) ON public.profiles TO authenticated;
-- SELECT / DELETE は従来どおりテーブル単位（自分の plan を読めるのは問題ない）。
GRANT SELECT, DELETE ON public.profiles TO authenticated;
-- service_role は全列（決済処理・/api/plan の読み取り）。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;

-- ── 3) 確認クエリ（任意）──────────────────────────────────────────────────
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--  WHERE table_name = 'profiles' AND column_name = 'plan';
-- SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
--  WHERE table_name = 'profiles' AND grantee = 'authenticated' ORDER BY 2, 3;
--   → INSERT/UPDATE の列に plan が無いこと。
-- SELECT plan, count(*) FROM public.profiles GROUP BY 1;

-- ── 正式版で特定アカウントをプラスにする例（決済ができるまでの手動運用）──────────
-- UPDATE public.profiles SET plan = 'plus' WHERE user_id = '<auth.users の id>';
