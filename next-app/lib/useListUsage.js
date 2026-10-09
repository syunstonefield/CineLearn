'use client';

// 利用データ（予習の流れの①: 単語リスト・lib/usage.js）。話の単語リストが出たら list_open を1回、
// 離れる時に「どこまでスクロールしたか（1割きざみ）×抜け方」を exit_list_<何割>_<walk|nav|close> で1回。
//   active … 一覧が出ている間 true／epKey … 話が変わったら別の回として数える
//   戻り値 toWalk() … 予習カードへ進む直前に呼ぶ（抜け方＝walk）
import { useCallback, useEffect, useRef } from 'react';
import { trackUsage, flushUsage } from './usage';
import { exitEventName } from './usageEvents';

export function useListUsage(listRef, active, epKey) {
  const s = useRef(null); // { key, max: 0〜10 } ＝今の回（終わったら null）
  const live = useRef(null); // いま一覧を出している回の key（片付けの直後に同じ key で付け直されたら続きとみなす）
  const end = useCallback((how) => {
    if (!s.current) return;
    trackUsage(exitEventName('list', s.current.max, how));
    s.current = null;
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const key = String(epKey);
    live.current = key;
    // 開発時の二重実行（付けて→外して→付け直す）では同じ回を続ける＝二重に数えない
    if (!s.current || s.current.key !== key) {
      end('nav');
      s.current = { key, max: 0 };
      trackUsage('list_open');
    }
    const measure = () => {
      const el = listRef.current;
      if (!el || !s.current) return;
      const r = el.getBoundingClientRect();
      if (r.height <= 0) return;
      const seen = Math.min(1, Math.max(0, (window.innerHeight - r.top) / r.height));
      s.current.max = Math.max(s.current.max, Math.floor(seen * 10));
    };
    measure();
    const onScroll = () => measure();
    const onHide = () => {
      end('close');
      flushUsage({ keepalive: true });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onHide);
      live.current = null;
      setTimeout(() => {
        if (live.current !== key && s.current?.key === key) end('nav');
      }, 0);
    };
  }, [active, epKey, listRef, end]);

  return useCallback(() => end('walk'), [end]);
}
