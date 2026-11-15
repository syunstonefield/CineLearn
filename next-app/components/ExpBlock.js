'use client';

import { useEffect, useState } from 'react';

// ── EXP獲得の表示（復習完了画面の主役・視聴後クイズの結果画面でも使う）─────────────────────────
// 獲得ぶんのカウントアップ＋レベルバー。加算そのものは ReviewDone の記録effectで済んでいて、
// ここは渡された結果を見せるだけ（描画をアンマウントしても二重加算しない）。
// 0→earned のカウントアップ。止まる瞬間の気持ちよさ優先で ease-out。
function useCountUp(earned) {
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
  return shown;
}

// 表記は「Exp」（「けいけん値」は幼い印象・2026-11-15 オーナー決定）。レベルの表示はそのまま。
export default function ExpBlock({ earned, lv }) {
  const shown = useCountUp(earned);
  return (
    <div className="exp-block">
      <div className="exp-gain">
        <span className="exp-gain-num">+{shown}</span>
        <span className="exp-gain-unit">Exp</span>
      </div>
      <div className="exp-level">
        <div className="exp-level-head">
          <span className="exp-level-name">レベル {lv.level}</span>
          <span className="exp-level-total">これまで {lv.total.toLocaleString()}</span>
        </div>
        <div className="exp-level-bar">
          <span className="exp-level-fill" style={{ width: `${Math.round(lv.progress * 100)}%` }} />
        </div>
        {/* 「次のレベルまで あと○」は出さない（足りない数を見せない・2026-11-14 オーナー採用 #p8）。英語のラベルは日本語に（#p4） */}
      </div>
    </div>
  );
}

// 1行版（復習の終わりの画面のまとめのカード・2026-11-15 オーナー採用 案A）: 「+24 Exp」・レベルのバー・「レベル 1」
export function ExpLine({ earned, lv }) {
  const shown = useCountUp(earned);
  return (
    <div className="exp-line">
      <span className="exp-line-gain">
        <b>+{shown}</b> Exp
      </span>
      <span className="exp-line-bar" aria-hidden="true">
        <i style={{ width: `${Math.round(lv.progress * 100)}%` }} />
      </span>
      <span className="exp-line-lv">レベル {lv.level}</span>
    </div>
  );
}
