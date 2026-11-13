'use client';

// 3重の円（あゆみタブの一番上）。docs/design-paid-features-2026-10-08.md「3重の円」「実装メモ 1」。
//   2026-11-10 見直し（受付の見本 reports/journey-ui-2026-11-10/mock.html・オーナー了承）: 円（左・148px）と数字3行（右）を
//   1枚の白い札に横並び。見出し・リード文はやめる。ことばの意味は円の下にいつも3行（2026-11-12）。最近覚えた単語は横に送る札。
//   外＝出会った（淡い金）／中＝覚えた（金）／内＝マスター（濃い金）。中心＝覚えた＋小さく「うち マスター N」（0の間は出さない）。
//   開いた時は前回見た値→今の値へ広がり、増えた分の弧だけ光る（マスター→覚えた→出会ったの順）。
//   prefers-reduced-motion では止まった絵で出す。
// values はすでに最高値（lib/rings.js settleRingValues）。縮むのは「出会った」を、利用者がコレクションから
// 作品を消去した時だけ（2026-11-07）。開くたびに 0 から伸ばすので、縮んだ値でも動きは同じ。
// 枠（values.tier）は台帳の最高値から決まり下がらない＝from / glowFrom の弧も同じ枠で描く（覚えた・マスターの弧は動かない）。
import { IconSparkle } from './icons/LineIcons';
import { useEffect, useRef, useState } from 'react';
import { ringFractions, ringTier } from '@/lib/rings';
import { subtitleCredit, loadRemovedWorks } from '@/lib/storage';
import { LEARNED_LABEL, MASTERED_LABEL, LEARNED_MEANING, MASTERED_MEANING } from '@/lib/learnedTerms';

const C = 160;
const SW = 14; // 線幅（320 の箱で）。表示 148px で約 6.5px
const RINGS = [
  { k: 'met', r: 144, cls: 'vr-arc-met' },
  { k: 'learned', r: 120, cls: 'vr-arc-learned' },
  { k: 'mastered', r: 96, cls: 'vr-arc-mastered' },
];
const KEYS = ['met', 'learned', 'mastered'];
const DELAYS = { mastered: 0, learned: 100, met: 180 }; // マスター→覚えた→出会った
const DUR = 1100;
const GLOW = 1400;

const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
const ease = (x) => 1 - Math.pow(1 - x, 3);

function Arc({ r, f0, f1, className, width = SW, opacity, filter }) {
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

function staticFrame(v, tier) {
  return { nums: v, fr: ringFractions(v, tier), prevFr: null, glow: 0 };
}

// glowFrom＝光らせる区間の始まり（前回見た値）。from から伸ばしつつ、glowFrom→今の値の差分だけ光る。
// ★動きの始点は「今画面に出ている値」（curRef）。途中で値が更新されても（PC で開いた直後にクラウド同期が
//   終わる等）、最終値から始め直して動きが消えることがない（2026-10-08 オーナー報告「PC で動かない」）。
//   開発時の StrictMode（effect が2回走る）でも、1回目で描かれていなければ 0 から動く。
function useRingAnimation(values, from, glowFrom) {
  // 枠は今の値のもの（settleRingValues の tier）。from / glowFrom は tier を持たないので同じ枠で描く。
  const tier = values.tier || ringTier(values.met);
  const [frame, setFrameState] = useState(() => staticFrame(from || values, tier));
  const curRef = useRef(from || values);
  const setFrame = (f) => {
    curRef.current = f.nums;
    setFrameState(f);
  };
  const glowRef = useRef(glowFrom);
  useEffect(() => {
    const to = values;
    const fromV = { ...curRef.current };
    const reduce =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const same = KEYS.every((k) => fromV[k] === to[k]);
    if (reduce || same) {
      setFrame(staticFrame(to, tier));
      return undefined;
    }
    const frFrom = ringFractions(fromV, tier);
    const frTo = ringFractions(to, tier);
    // 光る区間は「前回見た値→今の値」（最初の1回だけ）。それ以降の更新は伸びた分だけ光る
    const frGlow = glowRef.current ? ringFractions(glowRef.current, tier) : frFrom;
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
        setFrame({ nums, fr, prevFr: frGlow, glow });
        raf = requestAnimationFrame(tick);
      } else {
        glowRef.current = null; // 前回見た値からの光りは最初の動き切りで使い終わる
        setFrame(staticFrame(to, tier));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [values.met, values.learned, values.mastered, tier]); // eslint-disable-line react-hooks/exhaustive-deps
  return frame;
}

// 最近覚えた単語: 最初は4枚。「すべて見る」で20枚ずつ広げる（あゆみの中で・オーナー 2026-10-08）
const RECENT_FIRST = 4;
const RECENT_STEP = 20;

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
          <span className="vr-poster-initial">{(workTitle.replace(/^The /, '')[0] || '·').toUpperCase()}</span>
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
// posterFor(title) → posterPath。onOpen: 「前回から…」の行を押した先（最近覚えた単語へ）。
// glowFrom: 光らせる区間の始まり（前回見た値）。restClassName: 最近覚えた単語の欄に足す class（あゆみの出し方）。
export default function VocabRings({ values, from = null, glowFrom = null, gain = 0, recent = [], posterFor, onOpen, restClassName = '' }) {
  const { nums, fr, prevFr, glow } = useRingAnimation(values, from, glowFrom);
  const [all, setAll] = useState(false); // 「すべて見る」＝縦の一覧
  const [shown, setShown] = useState(RECENT_FIRST + RECENT_STEP); // 縦の一覧で何枚見せるか（20枚ずつ）
  if (!values || values.met <= 0) return null;
  const mastered0 = values.mastered <= 0;
  const removed = loadRemovedWorks().length > 0;
  const rows = [
    {
      k: 'met',
      name: '出会った',
      num: fmt(nums.met),
      // 消去した作品がある人だけ数え方を足す（ボタン名は「棚から外す」・ホーム・あゆみ部門 2026-11-07）
      desc: removed ? '出会った語（棚から外した作品も含む・消去した作品は学習した語だけ）' : 'これまでに出会った語（棚から外した作品も含む）',
    },
    { k: 'learned', name: LEARNED_LABEL, num: fmt(nums.learned), desc: LEARNED_MEANING },
    { k: 'mastered', name: MASTERED_LABEL, num: mastered0 ? null : fmt(nums.mastered), wait: '約3週間後から増えます', desc: MASTERED_MEANING },
  ];
  const canJump = !!onOpen && recent.length > 0;
  const Today = canJump ? 'button' : 'div';
  const list = all ? recent.slice(0, shown) : recent.slice(0, RECENT_FIRST);

  return (
    <div className="vr-wrap">
      <section className="vr-card" aria-label="覚えた語の数">
        <div className="vr-sum">
          <div
            className="vr-stage"
            role="img"
            aria-label={`覚えた ${values.learned}語、マスター ${values.mastered}語、出会った ${values.met}語`}
          >
            <svg viewBox="0 0 320 320" aria-hidden="true">
              <defs>
                <filter id="vr-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="6" />
                </filter>
              </defs>
              {RINGS.map((g) => (
                <g key={g.k}>
                  <circle cx={C} cy={C} r={g.r} fill="none" className="vr-track" strokeWidth={SW} />
                  <Arc r={g.r} f0={0} f1={fr[g.k]} className={g.cls} />
                  {glow > 0 && prevFr && fr[g.k] > prevFr[g.k] + 0.002 && (
                    <>
                      <Arc r={g.r} f0={prevFr[g.k]} f1={fr[g.k]} className="vr-arc-glow" width={SW + 8} opacity={glow} filter="url(#vr-glow)" />
                      <Arc r={g.r} f0={prevFr[g.k]} f1={fr[g.k]} className="vr-arc-glow2" opacity={glow * 0.8} />
                    </>
                  )}
                </g>
              ))}
            </svg>
            <div className="vr-center">
              <strong>{fmt(nums.learned)}</strong>
              <span>覚えた</span>
              {!mastered0 && <em>うち マスター {fmt(nums.mastered)}</em>}
            </div>
          </div>

          <div className="vr-nums">
            {rows.map((r) => (
              <div className="vr-nrow" key={r.k}>
                <i className={`vr-dot vr-dot-${r.k}`} aria-hidden="true" />
                <span className="vr-nname">{r.name}</span>
                {r.num != null ? <b className="vr-nnum">{r.num}</b> : <span className="vr-nwait">{r.wait}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* ことばの意味はいつも出す（押す所は気づかれなかった・オーナー決定 2026-11-12）。数字の横の列は SE で狭く
            1〜2字だけ次の行に落ちるので、円の下に幅いっぱいで。覚えた・マスターの文は lib/learnedTerms.js（復習・クイズと同じ）。 */}
        <dl className="vr-legend">
          {rows.map((r) => (
            <div key={r.k}>
              <dt>
                <i className={`vr-dot vr-dot-${r.k}`} aria-hidden="true" />
                {r.name}
              </dt>
              <dd>{r.desc}</dd>
            </div>
          ))}
        </dl>

        <Today {...(canJump ? { type: 'button', onClick: onOpen } : {})} className="vr-today">
          <span className="vr-spark" aria-hidden="true">
            <IconSparkle />
          </span>
          <span className="vr-t">
            {gain > 0 ? (
              <>
                前回から <b>{fmt(gain)}語</b> 覚えた語がふえました
              </>
            ) : (
              '予習した話の語を、復習で覚えていきましょう'
            )}
          </span>
          {canJump && <span aria-hidden="true">›</span>}
        </Today>
      </section>

      {recent.length > 0 && (
        <section className={`vr-recent ${restClassName}`.trim()} aria-labelledby="vr-recent-h">
          <div className="vr-rh">
            <h3 id="vr-recent-h">最近覚えた単語</h3>
            {recent.length > RECENT_FIRST && (
              <button
                type="button"
                aria-expanded={all}
                onClick={() => {
                  setAll((a) => !a);
                  setShown(RECENT_FIRST + RECENT_STEP);
                }}
              >
                {all ? 'たたむ' : 'すべて見る ›'}
              </button>
            )}
          </div>
          {/* 最初は横に送る札（4枚）。「すべて見る」で縦の一覧（20枚ずつ）。例文は全文＋出所を必ず一緒に（引用を途中で切らない） */}
          <div className={all ? 'vr-list' : 'vr-rail'}>
            {list.map((w) => (
              <WordCard key={w.key} w={w} poster={posterFor?.(w._src?.title || w.title)} />
            ))}
          </div>
          {all && shown < recent.length && (
            <button type="button" className="vr-more" onClick={() => setShown((n) => n + RECENT_STEP)}>
              もっと見る（あと {recent.length - shown}語）
            </button>
          )}
        </section>
      )}
    </div>
  );
}
