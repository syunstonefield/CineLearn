'use client';

// 3重の円（ホーム上段）。docs/design-paid-features-2026-10-08.md「3重の円」「実装メモ 1」・
// 確定モック https://claude.ai/artifact/9eUzWAJ3sK9EpY4fB4S6x6 （オーナー UI 案 CineLearnRingUI がベース）。
//   円弧 300／240／180・線幅11: 外＝出会った（淡い金）／中＝覚えた（金）／内＝マスター（濃い金）。
//   中心＝覚えた＋小さく「うち マスター N」（0の間は出さない）。
//   開いた時は前回見た値→今の値へ広がり、増えた分の弧だけ光る（マスター→覚えた→出会ったの順）。
//   prefers-reduced-motion では止まった絵で出す。
// values はすでに最高値（lib/rings.js settleRingValues）＝この部品は縮む値を受け取らない。
import { useEffect, useRef, useState } from 'react';
import { ringFractions } from '@/lib/rings';
import { subtitleCredit } from '@/lib/storage';

const C = 160;
const RINGS = [
  { k: 'met', r: 150 - 11, cls: 'vr-arc-met' },
  { k: 'learned', r: 120 - 11, cls: 'vr-arc-learned' },
  { k: 'mastered', r: 90 - 11, cls: 'vr-arc-mastered' },
];
const KEYS = ['met', 'learned', 'mastered'];
const DELAYS = { mastered: 0, learned: 100, met: 180 }; // マスター→覚えた→出会った
const DUR = 1100;
const GLOW = 1400;

const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
const ease = (x) => 1 - Math.pow(1 - x, 3);

function Arc({ r, f0, f1, className, width = 11, opacity, filter }) {
  const circ = 2 * Math.PI * r;
  const len = Math.max(0, f1 - f0) * circ;
  if (len <= 0.01) return null;
  return (
    <circle
      cx={C}
      cy={C}
      r={r}
      fill="none"
      className={className}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={`${len} ${circ}`}
      strokeDashoffset={-f0 * circ}
      transform={`rotate(-90 ${C} ${C})`}
      opacity={opacity}
      filter={filter}
    />
  );
}

function staticFrame(v) {
  return { nums: v, fr: ringFractions(v), prevFr: null, glow: 0 };
}

function useRingAnimation(values, from) {
  const [frame, setFrame] = useState(() => staticFrame(from || values));
  const lastRef = useRef(from || values);
  useEffect(() => {
    const to = values;
    const fromV = lastRef.current;
    lastRef.current = to;
    const reduce =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const same = KEYS.every((k) => fromV[k] === to[k]);
    if (reduce || same) {
      setFrame(staticFrame(to));
      return undefined;
    }
    const frFrom = ringFractions(fromV);
    const frTo = ringFractions(to);
    let raf = 0;
    let t0 = null;
    const end = DUR + Math.max(...Object.values(DELAYS));
    const tick = (ts) => {
      if (t0 === null) t0 = ts;
      const t = ts - t0;
      const fr = {};
      const nums = {};
      KEYS.forEach((k) => {
        const p = ease(Math.min(1, Math.max(0, (t - DELAYS[k]) / DUR)));
        fr[k] = frFrom[k] + (frTo[k] - frFrom[k]) * p;
        nums[k] = fromV[k] + (to[k] - fromV[k]) * p;
      });
      const glow = t < end ? 0.9 * Math.min(1, t / end) : Math.max(0, 0.9 * (1 - (t - end) / GLOW));
      if (t < end + GLOW) {
        setFrame({ nums, fr, prevFr: frFrom, glow });
        raf = requestAnimationFrame(tick);
      } else {
        setFrame(staticFrame(to));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [values.met, values.learned, values.mastered]); // eslint-disable-line react-hooks/exhaustive-deps
  return frame;
}

function posterSrc(p) {
  if (!p) return null;
  return p.startsWith('/') ? `https://image.tmdb.org/t/p/w185${p}` : p;
}

function WordCard({ w, poster }) {
  const credit = subtitleCredit(w);
  const s = w._src || {};
  const ep = s.title && s.type !== 'movie' && s.season != null && s.episode != null ? `S${s.season} E${s.episode}` : '';
  const workTitle = s.title || w.title || '';
  const src = posterSrc(poster);
  return (
    <article className="vr-wc">
      <div className="vr-poster" role="img" aria-label={workTitle ? `${workTitle} のポスター` : '作品'}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" />
        ) : (
          <span className="vr-poster-initial">{(workTitle.replace(/^The /, '')[0] || '🎬').toUpperCase()}</span>
        )}
        {ep && <span className="vr-poster-ep">{ep}</span>}
      </div>
      <div className="vr-wb">
        <div className="vr-wl">
          <strong>{w.word}</strong>
          <em className={`vr-st ${w.state === 'mastered' ? 'is-m' : 'is-l'}`}>
            {w.state === 'mastered' ? 'マスター' : '覚えた'}
          </em>
        </div>
        {w.definition && <p>{w.definition}</p>}
        {/* 例文（字幕の逐語引用）は出所（48条）が付けられる時だけ出す */}
        {credit && w.example && (
          <>
            <span className="vr-ex">“{w.example}”</span>
            <span className="vr-src">{credit}</span>
          </>
        )}
      </div>
    </article>
  );
}

// values / from: { met, learned, mastered }（from＝前回見た値・無ければ動きなし）
// gain: 前回から増えた「覚えた」の語数。recent: 最近覚えた語（collectRingWords の要素）。
// posterFor(title) → posterPath。onOpen: 円・カードのタップ先（無ければタップの手がかりを出さない）。
export default function VocabRings({ values, from = null, gain = 0, recent = [], posterFor, onOpen, onSeeAll }) {
  const { nums, fr, prevFr, glow } = useRingAnimation(values, from);
  if (!values || values.met <= 0) return null;
  const mastered0 = values.mastered <= 0;
  const Stage = onOpen ? 'button' : 'div';

  return (
    <div className="vr-wrap">
      <section className="vr-card">
        <div className="vr-copy">
          <div className="vr-eyebrow">🎬 あなたの語彙の旅</div>
          <h2>あなたの語彙</h2>
          <p>映画やドラマのワンシーンから、あなたの英語の世界が少しずつ広がっています。</p>
        </div>

        <Stage
          {...(onOpen ? { type: 'button', onClick: onOpen } : {})}
          className="vr-stage"
          aria-label={`覚えた ${values.learned}語、マスター ${values.mastered}語、出会った ${values.met}語${onOpen ? '。タップで詳しく' : ''}`}
        >
          <svg viewBox="0 0 320 320" aria-hidden="true">
            <defs>
              <filter id="vr-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" />
              </filter>
              <filter id="vr-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
            </defs>
            {RINGS.map((g) => (
              <g key={g.k}>
                <circle cx={C} cy={C} r={g.r} fill="none" className="vr-track" strokeWidth="11" />
                <Arc r={g.r} f0={0} f1={fr[g.k]} className={g.cls} opacity="0.35" filter="url(#vr-soft)" />
                <Arc r={g.r} f0={0} f1={fr[g.k]} className={g.cls} />
                {glow > 0 && prevFr && fr[g.k] > prevFr[g.k] + 0.002 && (
                  <>
                    <Arc r={g.r} f0={prevFr[g.k]} f1={fr[g.k]} className="vr-arc-glow" width={16} opacity={glow} filter="url(#vr-glow)" />
                    <Arc r={g.r} f0={prevFr[g.k]} f1={fr[g.k]} className="vr-arc-glow2" opacity={glow * 0.8} />
                  </>
                )}
              </g>
            ))}
          </svg>
          <div className={`vr-center${values.learned <= 0 ? ' is-zero' : ''}`}>
            <strong>{fmt(nums.learned)}</strong>
            <span>覚えた</span>
            {!mastered0 && <em>うち マスター {fmt(nums.mastered)}</em>}
          </div>
          {onOpen && <span className="vr-cue">タップで詳しく ›</span>}
        </Stage>

        <div className="vr-legend">
          <div className="vr-lrow">
            <i className="vr-dot vr-dot-met" />
            <b>{fmt(nums.met)}</b>
            <span>出会った</span>
            <small>これまでに出会った語（棚から外した作品も含む）</small>
          </div>
          <div className="vr-lrow">
            <i className="vr-dot vr-dot-learned" />
            <b>{fmt(nums.learned)}</b>
            <span>覚えた</span>
            <small>2回以上思い出せた語</small>
          </div>
          <div className="vr-lrow">
            <i className="vr-dot vr-dot-mastered" />
            <b>{mastered0 ? '―' : fmt(nums.mastered)}</b>
            <span>マスター</span>
            <small>{mastered0 ? '約3週間後から増えます' : '3週間あけても思い出せた語'}</small>
          </div>
          {(() => {
            const Tag = onOpen ? 'button' : 'div';
            return (
              <Tag {...(onOpen ? { type: 'button', onClick: onOpen } : {})} className="vr-today">
                <span className="vr-spark" aria-hidden="true">✦</span>
                <span className="vr-t">
                  {gain > 0 ? (
                    <>
                      前回から <b>{fmt(gain)}語</b> 覚えた語がふえました
                    </>
                  ) : (
                    '予習した話の語を、復習で覚えていきましょう'
                  )}
                </span>
                {onOpen && <span aria-hidden="true">›</span>}
              </Tag>
            );
          })()}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="vr-recent">
          <div className="vr-rh">
            <h3>🎬 最近覚えた単語・シーン</h3>
            {onSeeAll && (
              <button type="button" onClick={onSeeAll}>
                すべて見る ›
              </button>
            )}
          </div>
          <div className="vr-grid">
            {recent.map((w) => (
              <WordCard key={w.key} w={w} poster={posterFor?.(w._src?.title || w.title)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
