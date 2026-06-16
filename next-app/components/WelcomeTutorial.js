'use client';

// 初回ユーザー向けのウェルカム・チュートリアル（スライド型モーダル）。
// オンボーディング（TOEIC/サービス設定）完了直後、または既存ユーザーが
// 初めてダッシュボードに来たときに自動表示する。いつでもヘッダーの「?」から再表示できる。
// 役割は「機能紹介＋CineLearnでの学習の流れ」の説明（プロフィール初期設定の Onboarding とは別物）。

import { useState } from 'react';
import { useApp } from './AppProvider';

const ICON = {
  width: 40,
  height: 40,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

function IconFilm() {
  return (
    <svg {...ICON}>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <line x1="7" y1="4" x2="7" y2="20" />
      <line x1="17" y1="4" x2="17" y2="20" />
      <line x1="2.5" y1="9.3" x2="7" y2="9.3" />
      <line x1="2.5" y1="14.7" x2="7" y2="14.7" />
      <line x1="17" y1="9.3" x2="21.5" y2="9.3" />
      <line x1="17" y1="14.7" x2="21.5" y2="14.7" />
    </svg>
  );
}

function IconCapture() {
  return (
    <svg {...ICON}>
      <rect x="2.5" y="4.5" width="19" height="12" rx="2" />
      <line x1="8" y1="20" x2="16" y2="20" />
      <line x1="12" y1="16.5" x2="12" y2="20" />
      <path d="M10.5 8.2 14.5 10.5 10.5 12.8 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg {...ICON}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="9" y1="7" x2="16" y2="7" />
      <line x1="9" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function IconRepeat() {
  return (
    <svg {...ICON}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function IconRocket() {
  return (
    <svg {...ICON}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

// 出典つき・自分のレベルに最適化、という価値が伝わる順番で並べる。
const SLIDES = [
  {
    icon: <IconFilm />,
    title: 'CineLearnへようこそ',
    desc: '好きな海外ドラマや映画を観るだけで、あなたのレベルに合った英単語が自然に増えていく学習アプリです。「観る → 集める → 学ぶ → 復習」の4ステップで進みます。',
  },
  {
    icon: <IconCapture />,
    title: '① 観ながら単語を集める',
    desc: 'Netflixなどで拡張機能を入れておくと、字幕から重要単語と例文（出典つき）を自動でキャッチ。あなたのTOEICレベルに合わせて「いま覚えるべき語」だけを厳選します。',
    cta: '🧩 拡張機能の入れ方を見る',
  },
  {
    icon: <IconBook />,
    title: '② 自分専用の単語リストで学ぶ',
    desc: '作品ごとに単語カードが並びます。意味・例文・発音・出典をひと目で確認。準備ができたら「テスト」で定着度をチェックしましょう。',
  },
  {
    icon: <IconRepeat />,
    title: '③ 毎日の復習で記憶に定着',
    desc: '間隔反復（SRS）が最適なタイミングで出題します。「知ってた／うろ覚え／知らなかった」の3択で答えるほど忘れにくくなり、ストリークが継続を後押しします。',
  },
  {
    icon: <IconRocket />,
    title: 'さあ、始めましょう',
    desc: 'まずは観たい作品を1つ選んでみましょう。この使い方ガイドは、いつでもヘッダー右上の「?」から読み返せます。',
  },
];

export default function WelcomeTutorial() {
  const { tutorial, closeTutorial, openGuide } = useApp();
  const [step, setStep] = useState(0);

  const isFirst = step === 0;
  const isLast = step === SLIDES.length - 1;
  const slide = SLIDES[step];
  // オンボーディング流入時は閉じると作品追加へ進むので、CTA文言を分ける。
  const ctaLabel = tutorial === 'onboarding' ? '作品を選んで始める 🎬' : '閉じる';

  return (
    <div className="modal-overlay tutorial-overlay">
      <div className="modal-panel tutorial-panel" role="dialog" aria-modal="true" aria-label="使い方ガイド">
        <button className="modal-close tutorial-skip-x" onClick={closeTutorial} aria-label="閉じる">
          ✕
        </button>

        <div className="tutorial-body">
          <div className="onboarding-steps">
            {SLIDES.map((_, i) => (
              <div key={i} className={'onboarding-step' + (i === step ? ' active' : '')} />
            ))}
          </div>

          <div className="tutorial-slide" key={step}>
            <div className="tutorial-badge">{slide.icon}</div>
            <h2 className="onboarding-title">{slide.title}</h2>
            <p className="tutorial-desc">{slide.desc}</p>
            {slide.cta && (
              <button className="tutorial-cta" onClick={openGuide}>
                {slide.cta}
              </button>
            )}
          </div>
        </div>

        <div className="tutorial-footer">
          <button
            className="btn-primary"
            style={{ width: '100%' }}
            onClick={() => (isLast ? closeTutorial() : setStep((s) => s + 1))}
          >
            {isLast ? ctaLabel : '次へ →'}
          </button>
          <div className="tutorial-subnav">
            {!isFirst && (
              <button className="btn-text-link" onClick={() => setStep((s) => s - 1)}>
                ← 戻る
              </button>
            )}
            {!isLast && (
              <button className="btn-text-link" onClick={closeTutorial}>
                スキップ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
