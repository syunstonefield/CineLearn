-- 単語帳を「自分で選んだ語の場所」にする（オーナー決定 2026-11-07・③単語帳部門）
--
-- 1) in_wordbook の既定を false に
--    拡張のクリック保存は in_wordbook 列を送らない＝これまでは DB 既定の true で自動的に単語帳へ入っていた。
--    既定を false にすると、拡張で保存した語は作品の単語リスト・復習・あゆみの円には今までどおり残り、
--    単語帳には「★ 覚えたい」を付けた語だけが入る（アプリの ★ と手動追加は true を明示して送る）。
--    既存の行は変わらない（既定の変更は新しい行にだけ効く）＝今入っている語は消えない。
--    整理したい人には、単語帳を開いた時に一度だけ「このまま残す／★の語だけにする」を出す（アプリ側）。
--
-- 【適用】Supabase ダッシュボードの SQL Editor で実行する（in_wordbook と同じ手順）。
-- 送信側（next-app/lib/supabase.js の pushMyWord）は liked 列が無い間は外して再送するフォールバックを持つので、
-- この SQL の実行前でも同期は壊れない（♡がクラウドに残らないだけ・端末には残る）。
-- ⚠ 実行時期: 拡張 v1.2.12（他作品の印の絞り込み解除）の公開と、アプリの案内の文言（「保存した語は単語リストに残る・★で
--   単語帳へ」）の公開に合わせる（オーナー決定 2026-11-07・受付）。♡の列は supabase_my_words_liked.sql（先に実行）。
--   アプリ側の初回の整理画面は Vercel の環境変数 NEXT_PUBLIC_WORDBOOK_CURATION=on ＋再デプロイで出す（同じ時期）。
ALTER TABLE my_words ALTER COLUMN in_wordbook SET DEFAULT false;

-- ── 検証 ──
-- SELECT column_name, column_default FROM information_schema.columns WHERE table_name='my_words' AND column_name = 'in_wordbook';
