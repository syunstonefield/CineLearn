'use client';

// ホームのボタン案内（オーナー決定 2026-11-10・モック v6 の作り直し）。
//   暗くした画面の中を、明かり（くり抜き）がボタンからボタンへ滑って移る。札は明朝の題＋「n / N」＋1〜2行＋「スキップ」「次へ」。
//   並び順＝ヘッダー右の4つ → 下のタブ5つ（lib/introTour.js TOUR_STEPS）。ボタンは data-tour の目印で探し、その場で位置を測る
//   （座標を決め打ちしない＝スマホ・PC・幅が変わってもずれない）。ログイン済みは「ログイン」、画面に無いボタンは飛ばす。
//   終わると札が消え、明かりが「＋ 作品を追加」に戻って画面が明るくなり、＋ が3回そっと光る（E の 2）。
//   作品がまだ無い人は、最後の札のボタンが「作品を選んではじめる」＝押すと作品追加が開く（E の 1）。
//   ＋ を一度でも押した端末では光らせない（cl_tour_add_used）。
// 法務の条件（2026-11-10）: 本人の本物のホームの上に出す＝「見本の画面です」の行は出さない。穴と札はヘッダーと下のタブのボタンだけ。
//   どの札からも閉じられる（スキップ／最後の札の「はじめる」「閉じる」）。終わった後は画面下の表示がいつもどおり見える。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { trackUsage } from '@/lib/usage';
import { loadHistory } from '@/lib/storage';
import { tourSteps, lastTipAction, shouldGlowAdd, tipPosition, spotRect, lockPage, TOUR_ADD_USED_KEY } from '@/lib/introTour';

function visibleTargets() {
  const out = {};
  document.querySelectorAll('[data-tour]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') out[el.dataset.tour] = el;
  });
  return out;
}
// 画面に見えているポスター（TMDB の画像と、おすすめのポスターの枠）。札をこの上に重ねない（法務 2026-11-10）。
function posterRects() {
  const out = [];
  document.querySelectorAll('img[src*="image.tmdb.org"], .recommend-poster').forEach((el) => {
    if (el.closest('.ht-root')) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) out.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  });
  return out;
}
function addUsed() {
  try {
    return localStorage.getItem(TOUR_ADD_USED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function HomeTour() {
  const { tour, endTour, loggedIn, setScreen } = useApp();
  const counted = tour?.source === 'intro'; // 利用統計は初めての流れの時だけ
  const [steps, setSteps] = useState(null);
  const [idx, setIdx] = useState(0);
  const [spot, setSpot] = useState(null);
  const [tip, setTip] = useState(null);
  const [phase, setPhase] = useState('run'); // 'run' | 'end'（明るくなって ＋ が光る）
  const [glow, setGlow] = useState(false);
  const tipRef = useRef(null);
  const hasWorks = useRef(false);

  // 始める：ホームが描かれてからボタンを探す。見つからなければ何もせず閉じる。
  useEffect(() => {
    hasWorks.current = loadHistory().length > 0;
    const t = setTimeout(() => {
      const found = tourSteps({ loggedIn, present: Object.keys(visibleTargets()) });
      if (!found.length) return endTour();
      if (counted) trackUsage('tour_start');
      setSteps(found);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 案内の間はページを動かさない（スライドと同じ印・「引っ張って更新」も止める）。終わり（明るくなって ＋ が光る）で外す。
  useLayoutEffect(() => {
    if (phase !== 'run') return undefined;
    return lockPage();
  }, [phase]);

  const current = steps?.[idx];
  const targetKey = phase === 'end' ? 'add' : current?.key;

  // 明かりと札の位置を測る（幅が変わった時も）。札の高さは描いてから測る。
  const place = useCallback(() => {
    if (!targetKey) return;
    const el = visibleTargets()[targetKey];
    if (!el) {
      if (phase === 'end') endTour();
      return;
    }
    const r = el.getBoundingClientRect();
    setSpot(spotRect(r, 5));
    if (phase === 'run' && tipRef.current) {
      const tw = tipRef.current.offsetWidth;
      const th = tipRef.current.offsetHeight;
      setTip(tipPosition({ rect: r, vw: window.innerWidth, vh: window.innerHeight, tipW: tw, tipH: th, avoid: posterRects() }));
    }
  }, [targetKey, phase, endTour]);
  useLayoutEffect(() => {
    place();
  }, [place, idx, steps]);
  useEffect(() => {
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [place]);

  const finish = useCallback(
    ({ skipped = false, toAdd = false } = {}) => {
      if (counted) trackUsage(skipped ? 'tour_skip' : toAdd ? 'tour_add' : 'tour_done');
      if (toAdd) {
        endTour();
        setScreen('search');
        return;
      }
      const g = shouldGlowAdd({ addUsed: addUsed(), wentToAdd: false });
      setGlow(g);
      setPhase('end');
    },
    [counted, endTour, setScreen]
  );

  // 終わり：明るくなって ＋ が光ったら（約4秒）、または画面に触れたら消える。
  useEffect(() => {
    if (phase !== 'end') return undefined;
    const t = setTimeout(endTour, glow ? 4400 : 900);
    const onDown = () => endTour();
    window.addEventListener('pointerdown', onDown, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [phase, glow, endTour]);

  const next = () => {
    if (idx < steps.length - 1) setIdx((i) => i + 1);
    else finish();
  };

  useEffect(() => {
    if (phase !== 'run' || !steps) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish({ skipped: true });
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        next();
      }
      if (e.key === 'ArrowLeft' && idx > 0) setIdx((i) => i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!steps) return <div className="ht-root ht-wait" aria-hidden="true" />;
  const isLast = idx === steps.length - 1;
  const last = lastTipAction({ hasWorks: hasWorks.current });

  return (
    <div className={'ht-root' + (phase === 'end' ? ' is-end' : '')} role="dialog" aria-modal={phase === 'run'} aria-label="ボタンの案内">
      {spot && (
        <div
          className={'ht-spot' + (phase === 'end' && glow ? ' is-glow' : '')}
          style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }}
        />
      )}
      {phase === 'run' && current && (
        <div
          ref={tipRef}
          className={'ht-tip' + (tip ? '' : ' is-measuring')}
          style={tip ? { left: tip.left, top: tip.top } : undefined}
          key={current.key}
        >
          <div className="ht-tip-head">
            <b className="ht-tip-title">{current.title}</b>
            <span className="ht-tip-count">
              {idx + 1} / {steps.length}
            </span>
          </div>
          <p className="ht-tip-text">{current.text}</p>
          <div className="ht-tip-foot">
            {isLast && last.add ? (
              <button type="button" className="ht-tip-skip" onClick={() => finish()}>
                閉じる
              </button>
            ) : !isLast ? (
              <button type="button" className="ht-tip-skip" onClick={() => finish({ skipped: true })}>
                スキップ
              </button>
            ) : (
              <span />
            )}
            {isLast ? (
              <button type="button" className="ht-tip-next" onClick={() => (last.add ? finish({ toAdd: true }) : finish())}>
                {last.label}
              </button>
            ) : (
              <button type="button" className="ht-tip-next" onClick={next}>
                次へ
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
