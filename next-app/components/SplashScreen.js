'use client';

import { useEffect, useState } from 'react';

// アプリ起動時のブランドスプラッシュ（Netflix/Disney+風）。
// ダーク背景にロゴ＋ワードマークをフェード／スケールで表示し、約1.4秒後にフェードアウトして消える。
// SSRでも初期HTMLに含めるため、JSのhydrate前から画面を覆う（コンテンツのちらつき防止）。
export default function SplashScreen() {
  // 'show'（表示）→ 'fade'（フェードアウト中）→ 'done'（撤去）
  const [phase, setPhase] = useState('show');

  useEffect(() => {
    const toFade = setTimeout(() => setPhase('fade'), 2500);
    const toDone = setTimeout(() => setPhase('done'), 3000); // フェード500ms分待ってから撤去
    return () => {
      clearTimeout(toFade);
      clearTimeout(toDone);
    };
  }, []);

  if (phase === 'done') return null;

  return (
    <div
      className={'splash' + (phase === 'fade' ? ' splash-out' : '')}
      role="status"
      aria-label="CineLearn を起動中"
    >
      <div className="splash-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="splash-logo" src="/icon-512.png" alt="CineLearn" width={112} height={112} />
        <div className="splash-wordmark">
          Cine<span>Learn</span>
        </div>
      </div>
    </div>
  );
}
