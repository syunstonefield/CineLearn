-- 単語帳を「自分で選んだ語の場所」にする（オーナー決定 2026-11-07・③単語帳部門）
--
-- 1) in_wordbook の既定を false に
--    拡張のクリック保存は in_wordbook 列を送らない＝これまでは DB 既定の true で自動的に単語帳へ入っていた。
--    既定を false にすると、拡張で保存した語は作品の単語リスト・復習・あゆみの円には今までどおり残り、
--    単語帳には「★ 覚えたい」を付けた語だけが入る（アプリの ★ と手動追加は true を明示して送る）。
--    既存の行は変わらない（既定の変更は新しい行にだけ効く）＝今入っている語は消えない。
--    整理したい人には、単語帳を開いた時に一度だけ「このまま残す／★の語だけにする」を出す（アプリ側）。
-- 2) ♡（お気に入りの例文の印・法務 条件付きOK 2026-11-07）
--    liked      … 語に付いた例文（既存の sentence）に ♡ を付けたか。文は書き換えない・新しい文は保存しない。
--    liked_at   … 付けた日（表示順用）。
--    ♡は語に付ける印（語が見出し・例文は従）。利用者をまたいだ集計や共有キャッシュへの投入はしない。
--
-- 【適用】Supabase ダッシュボードの SQL Editor で実行する（in_wordbook と同じ手順）。
-- 送信側（next-app/lib/supabase.js の pushMyWord）は liked 列が無い間は外して再送するフォールバックを持つので、
-- この SQL の実行前でも同期は壊れない（♡がクラウドに残らないだけ・端末には残る）。
ALTER TABLE my_words ALTER COLUMN in_wordbook SET DEFAULT false;
ALTER TABLE my_words ADD COLUMN IF NOT EXISTS liked boolean NOT NULL DEFAULT false;
ALTER TABLE my_words ADD COLUMN IF NOT EXISTS liked_at TEXT;

-- ── 検証 ──
-- SELECT column_name, column_default FROM information_schema.columns WHERE table_name='my_words' AND column_name IN ('in_wordbook','liked','liked_at');
