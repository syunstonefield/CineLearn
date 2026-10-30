'use client';

import { useEffect, useState } from 'react';

// ── EXP獲得の表示（復習完了画面の主役・視聴後クイズの結果画面でも使う）─────────────────────────
// 獲得ぶんのカウントアップ＋レベルバー。加算そのものは ReviewDone の記録effectで済んでいて、
// ここは渡された結果を見せるだけ（描画をアンマウントしても二重加算しない）。
export default function ExpBlock({ earned, lv }) {
  // 0→earned のカウントアップ。止まる瞬間の気持ちよさ優先で ease-out。
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (earned <= 0) return;
    // 動きを減らす設定・非表示タブでは rAF が回らず 0 で固まるため即最終値。
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.hidden) {
      setShown(earned);
      return;
    }
    const dur = 800;
    let raf = 0;
    let start = null;
    const tick = (t) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / dur);
      setShown(Math.round(earned * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // 途中でタブが隠れて rAF が止まっても最終値だけは必ず出す保険
    const snap = setTimeout(() => setShown(earned), dur + 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(snap);
    };
  }, [earned]);

  return (
    <div className="exp-block">
      <div className="exp-gain">
        <span className="exp-gain-num">+{shown}</span>
        <span className="exp-gain-unit">EXP</span>
      </div>
      <div className="exp-level">
        <div className="exp-level-head">
          <span className="exp-level-name">Lv {lv.level}</span>
          <span className="exp-level-total">通算 {lv.total.toLocaleString()} EXP</span>
        </div>
        <div className="exp-level-bar">
          <span className="exp-level-fill" style={{ width: `${Math.round(lv.progress * 100)}%` }} />
        </div>
        {lv.next != null && <div className="exp-level-next">Lv {lv.level + 1} まで あと {lv.toNext.toLocaleString()}</div>}
      </div>
    </div>
  );
}
