'use client';

// 同期が止まった時の案内（2026-11-13 オーナー決定・見本 reports/sync-notice-2026-11-13/mock.png）。ホーム（Dashboard）だけに出す。
//   ① ログインの期限切れ（lib/supabase.js がサーバに断られた時だけ SESSION_EXPIRED_EVENT）＝下からのシートを1回。
//      閉じたらこの回（ページを読み込み直すまで）はもう出さない。次に起動した時にまだ切れていればまた出す。
//      カード（予習・復習・クイズ）や案内が重なっている間は出さない＝ホームに戻った時に出す。画面全体をふさがない。
//   ② オフライン・サーバの一時的な不調（setSyncTrouble）＝小さな札。ログインは求めない。つながったら消える。
//   「この端末の記録は消えません」は必ず添える（ログインし直すと max マージでまとめて同期される）。
import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import styles from './SyncNotice.module.css';

let sheetClosedThisLaunch = false; // モジュールの変数＝ホームを離れて戻っても保つ・読み込み直すと消える

export default function SyncNotice() {
  const { sessionExpired, loggedIn, syncTrouble, openAuth, reviewWords, prepQuiz, prepLaunch, prepWalk, authOpen, tutorial, guideOpen, tour } =
    useApp();
  const [closed, setClosed] = useState(sheetClosedThisLaunch);
  const busy = !!(reviewWords || prepQuiz || prepLaunch || prepWalk || authOpen || tutorial || guideOpen || tour);
  const showSheet = sessionExpired && !loggedIn && !closed && !busy;
  const close = () => {
    sheetClosedThisLaunch = true;
    setClosed(true);
  };
  useEffect(() => {
    if (!showSheet) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSheet]);

  const chip =
    loggedIn && !sessionExpired && syncTrouble
      ? syncTrouble === 'offline'
        ? 'オフライン中・つながったら自動で同期します'
        : '同期を待っています・自動でやり直します'
      : null;

  return (
    <>
      {chip && (
        <div className={styles.chip} role="status" aria-live="polite">
          <span className={styles.dot} aria-hidden="true" />
          {chip}
        </div>
      )}
      {showSheet && (
        <div className={styles.backdrop} onClick={close}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="sync-sheet-t" onClick={(e) => e.stopPropagation()}>
            <div className={styles.grab} aria-hidden="true" />
            <button type="button" className={styles.x} onClick={close} aria-label="閉じる">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <div className={styles.ic} aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <path d="M21 4v5h-5" />
              </svg>
            </div>
            <h2 id="sync-sheet-t" className={styles.t}>
              {/* 句読点の後で折り返す（スマホで「ま／す」だけが次の行に落ちないように） */}
              <span className={styles.nb}>ログインし直すと、</span>
              <span className={styles.nb}>同期が戻ります</span>
            </h2>
            <p className={styles.p}>ログインの期限が切れたため、ほかの端末や拡張機能との同期が止まっています。</p>
            <div className={styles.safe}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>この端末の学習の記録は消えません。ログインし直すと、まとめて同期されます。</span>
            </div>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                close();
                openAuth({ mode: 'login' });
              }}
            >
              ログインする
            </button>
            <button type="button" className={styles.later} onClick={close}>
              あとで
            </button>
          </div>
        </div>
      )}
    </>
  );
}
