'use client';

// 単語リストの画面（#screen-4）を「ヘッダーと下のタブのあいだ」に固定して、中身が収まる時はページを動かさない（2026-11-15）。
//   使う画面: 待ち画面（GenLoading）・作品の画面（CardHome）。
//   高さの計算（100dvh−ヘッダー）に頼らない＝ホーム画面に置いたアプリ（iPhone）で下のセーフエリアぶんずれる件を避ける
//   （復習の 948bbe7 と同じ考え方）。中身が入り切らない時は、固定した箱の中だけでふつうにスクロールする。
//   CSS は app/style.css の html.cl-screen-fit。2つの画面が入れ替わる時に外れないよう、数で持つ。
import { useLayoutEffect } from 'react';

let count = 0;

export function useScreenFit(on = true) {
  useLayoutEffect(() => {
    if (!on) return undefined;
    const root = document.documentElement;
    count += 1;
    root.classList.add('cl-screen-fit');
    const box = document.getElementById('screen-4');
    if (box) box.scrollTop = 0;
    return () => {
      count = Math.max(0, count - 1);
      if (count === 0) root.classList.remove('cl-screen-fit');
    };
  }, [on]);
}
