'use client';

// スライド式チュートリアル（オーナー決定 2026-11-10・モック reports/tutorial-carousel-mock-2026-11-08/v6）。
//   mode='first'：初めての人。スライド6枚 → レベルの質問（1画面）→ ホーム → ボタン案内（HomeTour）。
//                 「スキップ」でもレベルだけは聞く（B=1）。「ログイン・新規登録」で入ったあと、まだこの画面に居る人（新規登録・
//                 クラウドにプロフィールの無いアカウント）もレベルへ。既存のアカウントでログインした人はそのアカウントのホームへ（AppProvider）。
//   mode='help' ：ヘッダーの「? 使い方」から。スライド1〜6だけ。最後は「ボタンの案内も見る」「閉じる」。レベルは聞かない（C=1）。
//   1枚に主役を1つ（描いた見本）。見本はアプリの部品と同じ CSS（クイズの選択肢・額縁・復習カードの色）で描く。
//   見本の語・例文・和訳・作品名は自作／架空。出典・CEFR の印は出さない（誤った出典を出さないため）。
//   動きは1枚に1つ（CSS・「動きを減らす」設定では動かさない）。利用統計は mode='first' の時だけ（lib/usageEvents.js）。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { trackUsage } from '@/lib/usage';
import { TRIAL_LEVELS } from '@/lib/trial';
import { INTRO_SLIDES, INTRO_SAMPLE_NOTE, INTRO_STEP_KEY, lockPage, parseIntroStep } from '@/lib/introTour';

const LAST = INTRO_SLIDES.length - 1;

function Heading({ lines }) {
  return (
    <h2 className="intro-h">
      {lines.map((l) => (
        <span key={l} className="intro-h-line">
          {l}
        </span>
      ))}
    </h2>
  );
}

function ArtList() {
  return (
    <div className="intro-list">
      <div className="intro-list-ttl a1">Sample Drama　S1E1</div>
      <div className="intro-wrow a1">
        <div className="intro-w">
          <b>appreciate</b>
          <span>感謝する</span>
        </div>
        <div className="intro-ex">
          I really appreciate it.
          <small>本当に感謝してるよ。</small>
        </div>
      </div>
      <div className="intro-wrow is-sub a2">
        <div className="intro-w">
          <b>borrow</b>
          <span>借りる</span>
        </div>
      </div>
      <div className="intro-wrow is-sub a3">
        <div className="intro-w">
          <b>honest</b>
          <span>正直な</span>
        </div>
      </div>
    </div>
  );
}

// 復習カード（夕焼けシネマ）の色と形（--rc-*・ReviewCinemaCard）を使う。答えの3つもアプリと同じ色。
function ArtReview() {
  return (
    <div className="review-cinema intro-rc">
      <div className="intro-tk-wrap a1">
        <div className="intro-tk">
          <div className="intro-tk-word">appreciate</div>
          <div className="intro-tk-perf" />
          <div className="intro-tk-back">
            <b>感謝する</b>
            <i>
              I really <em>appreciate</em> it.
            </i>
            <small>本当に感謝してるよ。</small>
          </div>
        </div>
      </div>
      <div className="intro-rates a2">
        <span className="is-fail">知らなかった</span>
        <span className="is-hard">うろ覚え</span>
        <span className="is-easy">知ってた！</span>
      </div>
    </div>
  );
}

// クイズ（QuizScreen と同じ .quiz-card／.quiz-blank／.choice-btn）。主な形式＝穴埋め。答えた後に選択肢の横に語義。
function ArtQuiz() {
  const choices = [
    ['appreciate', '感謝する', true],
    ['borrow', '借りる'],
    ['decide', '決める'],
    ['convince', '納得させる'],
  ];
  return (
    <div className="quiz-card intro-quiz a1">
      <div className="quiz-q">
        “I really <span className="quiz-blank">____</span> it.”
      </div>
      <div className="quiz-ex-ja">本当に感謝してるよ。</div>
      <div className="quiz-choices">
        {choices.map(([w, ja, ok]) => (
          <div key={w} className={'choice-btn' + (ok ? ' correct intro-ok' : '')}>
            <span>{w}</span>
            <span className="choice-ja">{ja}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 額縁の見本（コレクションの .tcp-item.frame-* と同じ・中は無地＝初回体験の完了画面と同じ）。
function ArtFrames() {
  const tiers = [
    ['black', '黒縁', '30%', 'a1'],
    ['silver', '銀縁', '60%', 'a2'],
    ['gold', '金縁', '90%', 'a3'],
  ];
  return (
    <div className="intro-frames-wrap">
      <div className="intro-frames">
        {tiers.map(([k, label, pct, a]) => (
          <div key={k} className={`intro-frame ${a}`}>
            <span className={`tcp-item frame-${k}`}>
              <span className="tcp-frame">
                <span className="tcp-mat">
                  <span className="intro-frame-blank" />
                </span>
              </span>
            </span>
            <small>
              {label}
              <em>{pct}</em>
            </small>
          </div>
        ))}
      </div>
      <div className="intro-frames-cap a3">覚えた語の割合で変わります。</div>
    </div>
  );
}

// 拡張機能：黒地に字幕とふきだしだけ（配信サービスのプレーヤーの見た目はまねしない・字幕は普通の書体）。
function ArtExt() {
  return (
    <div className="intro-ext">
      <div className="intro-stage a1">
        <div className="intro-pop">
          <div className="intro-pop-in">
            <span className="intro-pop-wd">appreciate</span>
            <span className="intro-pop-ph">/əˈpriːʃieɪt/</span>
            <div className="intro-pop-ja">
              <small>この場面では</small>感謝する
            </div>
          </div>
          <div className="intro-pop-bt">
            <span className="is-save">✓ 保存</span>
            <span className="is-star">★ 覚えたい</span>
          </div>
        </div>
        <div className="intro-cap">
          I really <b>appreciate</b> it.
        </div>
      </div>
      <div className="intro-legend a2">
        <div>
          <b>✓ 保存</b>
          <span>その話の単語リストへ</span>
        </div>
        <div>
          <b>★ 覚えたい</b>
          <span>単語帳にも入れる</span>
        </div>
      </div>
    </div>
  );
}

const ART = { list: ArtList, review: ArtReview, quiz: ArtQuiz, frames: ArtFrames, ext: ArtExt };

function Progress({ at }) {
  return (
    <div className="intro-prog" aria-hidden="true">
      {INTRO_SLIDES.map((s, i) => (
        <i key={s.key} className={i <= at ? 'on' : ''} />
      ))}
    </div>
  );
}

export default function IntroCarousel({ mode = 'first' }) {
  const { openAuth, loggedIn, closeTutorial, finishIntro, startTour } = useApp();
  const first = mode === 'first';
  // 初めての流れは、読み直されても続きの枚から（このタブのあいだだけ覚える）。
  const [saved] = useState(() => {
    if (!first) return null;
    try {
      return parseIntroStep(sessionStorage.getItem(INTRO_STEP_KEY), LAST);
    } catch {
      return null;
    }
  });
  const [step, setStep] = useState(saved ?? 0); // 0〜5 = スライド、'level' = レベルの質問
  const touch = useRef(null);
  const rootRef = useRef(null);

  const track = (name) => {
    if (first) trackUsage(name);
  };

  useEffect(() => {
    if (saved == null) track('intro_start'); // 読み直して続きから出た時は数えない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!first) return;
    try {
      sessionStorage.setItem(INTRO_STEP_KEY, String(step));
    } catch {
      /* ignore */
    }
  }, [first, step]);

  // うしろのページを動かさない（スライドもレベルの画面も）。外すのは閉じた同じ描画の中で。
  useLayoutEffect(() => lockPage(), []);

  // スライドの中身が画面に収まっている時は、縦に指を動かしてもどこもスクロールさせない（iPhone の古い版で
  //   ページの固定を越えてうしろが動くのを防ぐ）。小さい画面で中身があふれる時は、スライドの中だけスクロールする。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const onMove = (e) => {
      if (el.scrollHeight <= el.clientHeight + 1) e.preventDefault();
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, [step]);

  // 初めての流れでログイン・新規登録したあと、まだこの画面に居る人（新規登録など）はレベルへ。
  const wasLoggedIn = useRef(loggedIn);
  useEffect(() => {
    if (first && loggedIn && !wasLoggedIn.current) setStep('level');
    wasLoggedIn.current = loggedIn;
  }, [first, loggedIn]);

  const go = (i) => {
    if (i < 0 || i > LAST) return;
    if (first && i > step) track(`intro_s${i + 1}`);
    setStep(i);
  };
  const skip = () => {
    if (!first) return closeTutorial();
    track('intro_skip');
    setStep('level');
  };
  const guest = () => {
    track('intro_guest');
    setStep('level');
  };
  const auth = (authMode) => {
    track('intro_auth_click');
    openAuth({ mode: authMode });
  };
  const chooseLevel = (lv) => {
    track('intro_level');
    try {
      sessionStorage.removeItem(INTRO_STEP_KEY);
    } catch {
      /* ignore */
    }
    finishIntro({ toeicScore: lv.score, userLevel: lv.level });
  };
  const seeTour = () => {
    closeTutorial();
    startTour('help');
  };

  // ← → キー（PC）と横のスワイプ（スマホ）で前後へ。
  useEffect(() => {
    if (step === 'level') return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(step + 1);
      if (e.key === 'ArrowLeft') go(step - 1);
      if (e.key === 'Escape' && !first) closeTutorial();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const onTouchStart = (e) => {
    const p = e.touches?.[0];
    touch.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onTouchEnd = (e) => {
    const s = touch.current;
    const p = e.changedTouches?.[0];
    touch.current = null;
    if (!s || !p || step === 'level') return;
    const dx = p.clientX - s.x;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(p.clientY - s.y) * 1.5) return;
    go(dx < 0 ? step + 1 : step - 1);
  };

  if (step === 'level') {
    return (
      <div className="intro-root" ref={rootRef} role="dialog" aria-modal="true" aria-label="英語レベル">
        <div className="intro-slide intro-level-slide">
          <div className="intro-top">
            <button type="button" className="intro-back" onClick={() => setStep(LAST)}>
              ← 戻る
            </button>
          </div>
          <div className="intro-level">
            <h2 className="intro-h">
              <span className="intro-h-line">いまの英語レベルは？</span>
            </h2>
            <p className="intro-p">
              レベルに合わせて、出す単語を変えます。点数は TOEIC の目安で、受けたことがなくても近いものを選べば大丈夫です。あとから変えられます。
            </p>
            <div className="intro-levels">
              {TRIAL_LEVELS.map((lv) => (
                <button key={lv.score} type="button" className="intro-level-btn" onClick={() => chooseLevel(lv)}>
                  <span className="intro-level-name">{lv.label}</span>
                  <span className="intro-level-range">{lv.range}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = INTRO_SLIDES[step];
  const isLast = step === LAST;
  const Art = ART[s.key];

  return (
    <div className="intro-root" ref={rootRef} role="dialog" aria-modal="true" aria-label="使い方" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {s.key === 'cover' ? (
        <div className="intro-slide intro-cover-slide" key={step}>
          <div className="intro-top">
            <span />
            <button type="button" className="intro-skip" onClick={skip}>
              {first ? 'スキップ' : '閉じる'}
            </button>
          </div>
          <div className="intro-cover">
            <img className="intro-icon a1" src="/icon-512.png" alt="" />
            <h1 className="intro-cover-h a2">
              <b>CineLearn</b> へようこそ
            </h1>
            <p className="intro-cover-p a3">観たいドラマが、英単語の教材に。</p>
          </div>
          <div className="intro-foot">
            <Progress at={0} />
            <button type="button" className="intro-btn" onClick={() => go(1)}>
              次へ
            </button>
            {first && !loggedIn && (
              <button type="button" className="intro-login" onClick={() => auth('login')}>
                すでにアカウントをお持ちの方はログイン
              </button>
            )}
            <div className="intro-links">
              <a href="/terms" target="_blank" rel="noopener">
                利用規約
              </a>
              <a href="/privacy" target="_blank" rel="noopener">
                プライバシーポリシー
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className={'intro-slide' + (isLast ? ' is-last' : '')} key={step}>
          <div className="intro-top">
            <span className="intro-logo">
              Cine<span>Learn</span>
            </span>
            {!isLast && (
              <button type="button" className="intro-skip" onClick={skip}>
                {first ? 'スキップ' : '閉じる'}
              </button>
            )}
          </div>
          <div className="intro-head">
            <Heading lines={s.h} />
            <p className="intro-p">
              <span className={'intro-p-sp' + (s.pcP ? ' has-pc' : '')}>{s.p}</span>
              {s.pcP && <span className="intro-p-pc">{s.pcP}</span>}
            </p>
          </div>
          <div className={`intro-art intro-art-${s.key}`}>
            <Art />
          </div>
          <div className="intro-foot">
            <div className="intro-note">{INTRO_SAMPLE_NOTE}</div>
            <Progress at={step} />
            {!isLast ? (
              <button type="button" className="intro-btn" onClick={() => go(step + 1)}>
                次へ
              </button>
            ) : first ? (
              <>
                <button type="button" className="intro-btn" onClick={guest}>
                  登録せずに開始
                </button>
                <button type="button" className="intro-btn2" onClick={() => auth('signup')}>
                  ログイン・新規登録
                </button>
              </>
            ) : (
              <>
                <button type="button" className="intro-btn" onClick={seeTour}>
                  ボタンの案内も見る
                </button>
                <button type="button" className="intro-btn2" onClick={closeTutorial}>
                  閉じる
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
