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
import { isMobileDevice } from '@/lib/device';
import { trackUsage } from '@/lib/usage';
import { TRIAL_LEVELS } from '@/lib/trial';
import { INTRO_SAMPLE_NOTE, INTRO_HOME_NOTE, INTRO_STEP_KEY, HOME_IOS_HINT, detectHomeScreenKind, homeSlideText, introSlidesFor, lockPage, parseIntroStep } from '@/lib/introTour';


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

// ホーム画面に追加（オーナー決定 2026-11-12・法務は条件付き可）: 自作の絵＝ホーム画面のアイコンの並び（中身のない四角）と、手順の2つの札。
//   配信サービスの名前・ポスター・作品名は出さない。iPhone は共有ボタン（＋見つからない時は「…」の中）、Android は Chrome のメニュー（︙）。
//   法務の条件: 共有の絵は自作（四角＋上向きの矢印・アプリの茶色）・ロゴや本物の画面の写しは使わない・機種の枠は角の丸い長方形だけ・
//   「公式」「推奨」のような語は入れない・絵の下に INTRO_HOME_NOTE の1行。
//   Android で Chrome から追加の合図（beforeinstallprompt・app/(app)/layout.js で取っておく）が来ている時は、手順の札の代わりに
//   「ホーム画面に追加する」ボタン（押すと Chrome の追加の確認が出る）。合図が来ない端末では手順の札。
function ArtHome({ kind, canPrompt, added, onAdd }) {
  const ios = kind === 'ios';
  if (added || (kind === 'android' && canPrompt)) {
    return (
      <div className="intro-home">
        <HomePhone />
        <div className="intro-home-steps a2">
          {added ? (
            <div className="intro-home-step is-target is-done">
              <span className="intro-home-ic" aria-hidden="true">
                ✓
              </span>
              <span>ホーム画面に追加しました</span>
            </div>
          ) : (
            <button type="button" className="intro-home-add" onClick={onAdd}>
              <span aria-hidden="true">＋</span> ホーム画面に追加する
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="intro-home">
      <HomePhone />
      <div className="intro-home-steps a2">
        <div className="intro-home-step">
          <span className="intro-home-ic" aria-hidden="true">
            {ios ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="M8 7l4-4 4 4" />
                <path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
              </svg>
            ) : (
              <b>︙</b>
            )}
          </span>
          <span>{ios ? '共有ボタン' : 'Chrome の右上のメニュー'}</span>
        </div>
        {ios && <span className="intro-home-hint">{HOME_IOS_HINT}</span>}
        <span className="intro-home-arrow" aria-hidden="true">
          ↓
        </span>
        <div className="intro-home-step is-target">
          <span className="intro-home-ic" aria-hidden="true">
            {ios ? '＋' : '⊕'}
          </span>
          <span>ホーム画面に追加</span>
        </div>
      </div>
    </div>
  );
}

function HomePhone() {
  return (
    <div className="intro-home-phone a1" aria-hidden="true">
      {Array.from({ length: 11 }, (_, i) => (
        <i key={i} />
      ))}
      <img className="intro-home-app" src="/icon-192.png" alt="" />
    </div>
  );
}


// 拡張機能のスライド（スマホで見ている人だけ・オーナー決定 2026-11-13・法務は条件付き可）: 「PC で開くリンクを送る」（自分の PC へ）。
//   押すと端末の共有（navigator.share）で、アプリの紹介ページの「はじめかた」の URL と当社の案内の文を渡す。共有が使えない端末ではリンクをコピー。
//   法務の条件: 文は当社の案内（利用者の感想のようにしない）・配信サービス名/作品名/効果の言い切り/「無料」を入れない・紹介の特典なし・
//   URL の印は固定値 ?from=share だけ（人を特定できる値は付けない）・人に勧める呼びかけにしない・
//   回数は固定名 intro_share だけ（送り先・共有したか取りやめたかの内訳・アプリ名は記録しない）。
const EXT_SHARE_URL = 'https://cinelearn-next.vercel.app/?from=share#setup';
const EXT_SHARE_TEXT = 'CineLearn を PC で開く';
function ExtShare() {
  const [copied, setCopied] = useState(false);
  const onShare = async () => {
    trackUsage('intro_share'); // 押した回数だけ（共有したか・取りやめたか・送り先は記録しない）
    try {
      if (navigator.share) {
        await navigator.share({ title: 'CineLearn', text: EXT_SHARE_TEXT, url: EXT_SHARE_URL });
        return;
      }
    } catch {
      return; // 閉じた・断った時は何もしない
    }
    try {
      await navigator.clipboard.writeText(`${EXT_SHARE_TEXT}：${EXT_SHARE_URL}`);
      setCopied(true);
    } catch {
      /* コピーもできない端末は何もしない */
    }
  };
  return (
    <div className="intro-ext-share a3">
      <button type="button" className="intro-ext-share-btn" onClick={onShare}>
        PC で開くリンクを送る
      </button>
      <span className="intro-ext-share-note">{copied ? 'リンクをコピーしました' : '自分の PC に送って、あとで開けます'}</span>
    </div>
  );
}

const ART = { list: ArtList, review: ArtReview, quiz: ArtQuiz, frames: ArtFrames, ext: ArtExt, home: ArtHome };

function Progress({ at, slides }) {
  return (
    <div className="intro-prog" aria-hidden="true">
      {slides.map((s, i) => (
        <i key={s.key} className={i <= at ? 'on' : ''} />
      ))}
    </div>
  );
}

export default function IntroCarousel({ mode = 'first' }) {
  const { openAuth, loggedIn, closeTutorial, finishIntro, startTour } = useApp();
  const first = mode === 'first';
  // 「ホーム画面に追加」を出す端末か（iPhone・Android・まだホーム画面から開いていない）。開いている間は変えない。
  const [homeKind] = useState(() => detectHomeScreenKind());
  // スマホで見ている人だけ、拡張機能のスライドに「PC で開くリンクを送る」（オーナー決定 2026-11-13）
  const [onPhone] = useState(() => isMobileDevice());
  const slides = introSlidesFor(homeKind);
  // Android の Chrome から来た追加の合図（app/(app)/layout.js が window.__clInstallPrompt に取っておく）。1回しか使えない。
  const [installEvt, setInstallEvt] = useState(() => (typeof window === 'undefined' ? null : window.__clInstallPrompt || null));
  const [added, setAdded] = useState(false);
  useEffect(() => {
    const sync = () => setInstallEvt(window.__clInstallPrompt || null);
    window.addEventListener('cl-installprompt', sync);
    return () => window.removeEventListener('cl-installprompt', sync);
  }, []);
  const canPrompt = homeKind === 'android' && !!installEvt;
  const addToHome = async () => {
    const e = installEvt;
    if (!e) return;
    window.__clInstallPrompt = null;
    setInstallEvt(null); // 断られたら手順の札に戻る（合図は使い切り）
    try {
      await e.prompt();
      const c = await e.userChoice;
      if (c?.outcome === 'accepted') setAdded(true);
    } catch {
      /* 手順の札のまま */
    }
  };
  const LAST = slides.length - 1;
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
    // ★ 指が少しでも動くと touchmove が来る。その全部を止めると、iPhone ではタップ（押した）まで取り消される
    //   （「押しても何も起きない」が交互に起きた・2026-11-10 深夜）。止めるのは、はっきり縦に引いた時（8px 超）だけ。
    let startY = null;
    const onStart = (e) => {
      startY = e.touches?.[0]?.clientY ?? null;
    };
    const onMove = (e) => {
      if (startY == null || el.scrollHeight > el.clientHeight + 1) return;
      const y = e.touches?.[0]?.clientY;
      if (y != null && Math.abs(y - startY) > 8) e.preventDefault();
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
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
                  <span className="intro-level-name">
                    {lv.label}
                    {lv.pick && <em className="intro-level-pick">迷ったらここ</em>}
                  </span>
                  <span className="intro-level-range">{lv.range}</span>
                  {lv.hint && <span className="intro-level-hint">{lv.hint}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = slides[step];
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
            <Progress at={0} slides={slides} />
            <button type="button" className="intro-btn" onClick={() => go(1)}>
              次へ
            </button>
            {first && !loggedIn && (
              <button type="button" className="intro-login" onClick={() => auth('login')}>
                すでにアカウントをお持ちの方はログイン
              </button>
            )}
            {/* 「? 使い方」から開いた時だけ：もう使っている人は「どこに何があるか」を知りたい＝6枚を見ずにボタンの案内へ（オーナー 2026-11-10） */}
            {!first && (
              <button type="button" className="intro-login" onClick={seeTour}>
                ボタンの案内を見る
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
              <span className={'intro-p-sp' + (s.pcP ? ' has-pc' : '')}>{s.key === 'home' ? homeSlideText(homeKind, canPrompt, added) : s.p}</span>
              {s.pcP && <span className="intro-p-pc">{s.pcP}</span>}
            </p>
          </div>
          <div className={`intro-art intro-art-${s.key}`}>
            <Art kind={homeKind} canPrompt={canPrompt} added={added} onAdd={addToHome} />
            {s.key === 'ext' && onPhone && <ExtShare />}
          </div>
          <div className="intro-foot">
            <div className="intro-note">{s.key === 'home' ? INTRO_HOME_NOTE : INTRO_SAMPLE_NOTE}</div>
            <Progress at={step} slides={slides} />
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
