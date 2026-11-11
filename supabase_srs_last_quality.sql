-- srs_data.last_quality（最後の答え）列追加 ★「知らなかった／うろ覚えの語をもう一度」（オーナー決定 2026-11-12・案1・無料）
-- ⏳未適用。オーナーが Supabase ダッシュボードの SQL Editor で実行する（受付から手順）。
--
-- 【なぜ必要か】
-- 復習タブの「知らなかった語をもう一度」「うろ覚えの語をもう一度」は、語ごとの最後の答え
-- （0＝知らなかった／3＝うろ覚え／5＝知ってた）で語を集める。端末（cl_srs の lastQuality）には残っているが、
-- クラウド（srs_data）に列が無いため、別の端末で答えた語の「最後の答え」が分からなかった。
--
-- 【流す前にデプロイしても壊れない】
-- 送信側（next-app/lib/supabase.js pushSrsWords）は、列が無い間は last_quality を外して再送する＝復習の同期は止まらない。
-- その間は端末の値だけで動く。クラウドから取り込んだ語は「復習済みで repetitions=0」なら知らなかったとみなす
-- （next-app/lib/againWords.js lastAnswerOf）。
--
-- 【過去の分の埋め方＝コードで行う（この SQL では埋めない）】
-- ・知らなかった: 上のとおり repetitions=0 から読む（列が空でも出る）。
-- ・うろ覚え: クラウドの列からは見分けられないので、端末に残っている値をアプリが次の同期で送る
--   （lib/srsMerge.js localWinsPush: 列があって空の行は、同じ日の端末の値を吸い上げる）。列を足した後に答えた分は自動で入る。
--
-- 負荷: 通信回数は増えない（採点時の1行に列が1つ増えるだけ）。NULL 許容・既存行に影響なし。
-- GRANT は既存の srs_data の権限がそのまま列にも効く（列単位の GRANT は使っていない）。

-- ── ① 確かめる（読み取りだけ・流す前） ──
-- 列がまだ無いこと（0行なら未適用）
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'srs_data' AND column_name = 'last_quality';

-- ── ② 足す ──
ALTER TABLE srs_data ADD COLUMN IF NOT EXISTS last_quality smallint;

-- ── ③ 足した後の確認（読み取りだけ） ──
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'srs_data' AND column_name = 'last_quality';
-- 自分の最後の答えの内訳（アプリで1語答えた後に 1行以上出る）
-- SELECT last_quality, count(*) FROM srs_data
--   WHERE user_id = auth.uid() AND last_quality IS NOT NULL GROUP BY last_quality ORDER BY last_quality;

-- ── 戻し方（列ごと消す・アプリは列が無い状態の動きに戻るだけ） ──
-- ALTER TABLE srs_data DROP COLUMN IF EXISTS last_quality;
