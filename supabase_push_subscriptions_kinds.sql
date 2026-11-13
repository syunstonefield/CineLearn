-- 通知の朝／夕方を端末ごとに選べるようにする（2026-11-13・app/api/push-subscribe PATCH・app/api/push-notify）。
-- SQL エディタで1つずつ流す（どちらも何度流しても同じ・既存の購読は両方 true＝今までどおり届く）。
-- 列が無い間も通知は今までどおり送られる（送る側は「列が無い＝受け取る」と読む）。設定の画面の朝／夕方の切り替えだけが出ない。

-- ① 朝の通知を受け取るか
alter table public.push_subscriptions add column if not exists morning boolean not null default true;

-- ② 夕方の通知を受け取るか
alter table public.push_subscriptions add column if not exists evening boolean not null default true;

-- 確かめ（読むだけ）: 列が2つ増えていること
-- select column_name, data_type, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'push_subscriptions' order by ordinal_position;
