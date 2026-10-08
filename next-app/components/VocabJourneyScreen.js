'use client';

// あゆみタブ（下のタブ・オーナー 2026-10-08 で「円のタップ先」から変更）。
// docs/design-paid-features-2026-10-08.md「実装メモ 4」・モック https://claude.ai/artifact/NYPowDEgA8ceU7vM7YCfem 。
//   上から 3重の円（VocabRings・ホームから移設）→「学習した日」（草・無料）→「週ごとの推移」（プラス）。
//   円の有料/無料は保留（PLAN_FEATURES.ring・canShowRings）＝このタブの中で後から出し分けられる。
//   数え方・しきい値・文言は lib/journey.js の JOURNEY に集約（ここは描くだけ）。
//   罪悪感 UI を作らない: 空いた日は薄い色・連続日数／休んだ日数は出さない・下がった週を赤くしない。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import VocabRings from './VocabRings';
import GrassCard from './GrassCard';
import PlusNote from './PlusNote';
import { featureAccess, usePlan } from '@/lib/plan';
import { canShowRings, loadRingSeen, saveRingSeen, settleRingValues } from '@/lib/rings';
import { loadExpLedger } from '@/lib/exp';
import { buildLibraryEntries, collectRingWords, loadHistory, loadSrs, loadStatsDaily, ringCounts, statsByDay } from '@/lib/storage';
import { getActiveWords, sameWorkTitle } from '@/lib/words';
import { JOURNEY, buildGrass, buildTrend, md, niceMax, statsStart } from '@/lib/journey';

const T = JOURNEY.text;

// SVG の幅は実際の表示幅に合わせる（固定 viewBox を縮めるとスマホで目盛りの文字が潰れる）。
function useBoxWidth(fallback) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

function TrendChart({ series }) {
  const [boxRef, boxW] = useBoxWidth(640);
  const W = Math.max(280, Math.min(760, boxW));
  const H = 250;
  const Lp = 44;
  const R = 44;
  const Tp = 22;
  const B = 30;
  const n = series.length;
  const learned = series.map((s) => s.learned);
  const mastered = series.map((s) => s.mastered);
  const ok = series.map((s) => s.ok);
  const yMax = niceMax(Math.max(...learned, ...mastered), 20);
  const okMax = niceMax(Math.max(...ok), 20);
  const x = (i) => Lp + ((i + 0.5) * (W - Lp - R)) / n;
  const y = (v) => Tp + (H - Tp - B) * (1 - v / yMax);
  const yb = (v) => Tp + (H - Tp - B) * (1 - v / okMax);
  const bw = ((W - Lp - R) / n) * 0.46;
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - Lp - R) / 64))));
  const last = n - 1;
  const gL = learned[last] - learned[0];
  const gM = mastered[last] - mastered[0];
  const summary = T.trendSummary(n, gL, gM);

  return (
    <div ref={boxRef} className="vj-chartbox">
      <svg
        className="vj-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${n}週間の推移。覚えた ${learned[0]}語から ${learned[last]}語、マスター ${mastered[0]}語から ${mastered[last]}語へ`}
      >
        {[0, 1, 2, 3, 4].map((g) => {
          const gy = y((yMax * g) / 4);
          return (
            <g key={g}>
              <line x1={Lp} x2={W - R} y1={gy} y2={gy} className="vj-grid" />
              <text x={Lp - 8} y={gy + 4} textAnchor="end" className="vj-axis">
                {Math.round((yMax * g) / 4)}
              </text>
              <text x={W - R + 8} y={gy + 4} className="vj-axis2">
                {Math.round((okMax * g) / 4)}
              </text>
            </g>
          );
        })}
        {ok.map((v, i) =>
          v > 0 ? <rect key={i} x={x(i) - bw / 2} y={yb(v)} width={bw} height={H - B - yb(v)} rx="3" className="vj-bar" /> : null
        )}
        <path d={`${path(learned)} L${x(last)} ${H - B} L${x(0)} ${H - B} Z`} className="vj-area" />
        <path d={path(learned)} fill="none" className="vj-line-learned" strokeWidth="2.5" strokeLinejoin="round" />
        <path d={path(mastered)} fill="none" className="vj-line-mastered" strokeWidth="2.5" strokeLinejoin="round" />
        {[
          [learned, '覚えた', 'vj-dot-learned', -10],
          [mastered, 'マスター', 'vj-dot-mastered', 18],
        ].map(([arr, name, cls, dy]) => (
          <g key={name}>
            <circle cx={x(last)} cy={y(arr[last])} r="4.5" className={cls} strokeWidth="2" />
            <text x={x(last) - 8} y={y(arr[last]) + dy} textAnchor="end" className="vj-endlabel">
              {name} {arr[last]}
            </text>
          </g>
        ))}
        {series.map((s, i) =>
          (last - i) % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="vj-axis">
              {md(s.weekStart)}週
            </text>
          ) : null
        )}
      </svg>
      <div className="vj-legend">
        <span>
          <i className="vj-key-learned" />
          覚えた（累計・左の目盛り）
        </span>
        <span>
          <i className="vj-key-mastered" />
          マスター（累計・左の目盛り）
        </span>
        <span>
          <i className="vj-key-bar" />
          その週に思い出せた数（右の目盛り）
        </span>
      </div>
      {summary && <p className="vj-hint">{summary}</p>}
    </div>
  );
}

function Trend({ trend, plan }) {
  const a = featureAccess('trend', plan);
  const minW = JOURNEY.trendMinWeeks;
  let body;
  if (a.locked) {
    body = (
      <div className="vj-lock">
        <b>{T.trendTitle}はプラスの機能です</b>
        <span>{T.trendLocked}</span>
      </div>
    );
  } else if (!trend.ready) {
    const have = Math.min(minW, trend.recorded);
    body = (
      <div className="vj-wait">
        <div className="vj-wait-big">{T.trendWait}</div>
        <div>{T.trendWaitSub(minW, trend.start ? md(trend.start) : '今日')}</div>
        <div className="vj-prog" role="img" aria-label={`${minW}週のうち ${have}週`}>
          {Array.from({ length: minW }, (_, i) => (
            <span key={i} className={i < have ? 'is-on' : ''} />
          ))}
        </div>
      </div>
    );
  } else {
    body = <TrendChart series={trend.series} />;
  }
  return (
    <section className="vj-card" aria-labelledby="vj-trend-h">
      <div className="vj-ch">
        <h3 id="vj-trend-h">{T.trendTitle}</h3>
        <PlusNote feature="trend" plan={plan} />
      </div>
      {body}
    </section>
  );
}

// 3重の円の値（ホームにあった処理を移設）。値は最高値＝縮まない。開いた時は「前回見た値」から広がる。
// 母数は履歴＋マイ単語帳の語（getActiveWords は非同期＝揃ってから描く・途中の小さい値で動かさない）。
function useRings({ mounted, profile, settings, version }) {
  const [myWords, setMyWords] = useState(null);
  useEffect(() => {
    if (!mounted) return undefined;
    let cancelled = false;
    getActiveWords(profile?.id)
      .then((w) => !cancelled && setMyWords(w || []))
      .catch(() => !cancelled && setMyWords([]));
    return () => {
      cancelled = true;
    };
  }, [mounted, profile, version]);

  const words = useMemo(
    () => (myWords ? collectRingWords(loadHistory(), myWords, loadSrs(), sameWorkTitle) : null),
    [myWords, version] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [ring, setRing] = useState(null); // { values, from, glowFrom, gain }
  const base = useRef(undefined); // このタブを開いた時点の「前回見た値」（null＝初めて）
  useEffect(() => {
    if (!words) return;
    const values = settleRingValues(ringCounts(words)); // 今日の行にも最高値を残す
    if (base.current === undefined) base.current = loadRingSeen();
    const b = base.current;
    // 円弧と数字は毎回 0 から伸ばす（オーナー 2026-10-08）。光るのは「前回見た値→今の値」の差分だけ。
    const glowFrom = b
      ? { met: Math.min(b.met, values.met), learned: Math.min(b.learned, values.learned), mastered: Math.min(b.mastered, values.mastered) }
      : null;
    const ZERO = { met: 0, learned: 0, mastered: 0 };
    setRing((prev) => ({
      values,
      from: prev ? prev.from : ZERO,
      glowFrom: prev ? prev.glowFrom : glowFrom,
      gain: b ? Math.max(0, values.learned - b.learned) : 0,
    }));
    saveRingSeen(values);
  }, [words]);

  // 最近覚えた語（出会っただけの語は並べない）。新しい順に、まず作品がばらけるように4枚を先頭に置く。
  const recent = useMemo(() => {
    const sorted = (words || [])
      .filter((w) => (w.state === 'learned' || w.state === 'mastered') && w.lastReview)
      .sort((a, b) => String(b.lastReview).localeCompare(String(a.lastReview)));
    const picked = [];
    const titles = new Set();
    sorted.forEach((w) => {
      const t = w._src?.title || w.title;
      if (picked.length >= 4 || titles.has(t)) return;
      titles.add(t);
      picked.push(w);
    });
    sorted.forEach((w) => {
      if (picked.length < 4 && !picked.includes(w)) picked.push(w);
    });
    // 「すべて見る」で広げる続き＝最初の4枚のあとに、残りを新しい順で（オーナー 2026-10-08）
    return [...picked, ...sorted.filter((w) => !picked.includes(w))];
  }, [words]);

  const posterFor = useMemo(() => {
    const myDramas = settings?.myDramas || [];
    const entries = mounted ? buildLibraryEntries(loadHistory(), myDramas) : [];
    return (t) =>
      !t
        ? null
        : myDramas.find((d) => sameWorkTitle(d.title, t))?.posterPath ||
          entries.find((e) => sameWorkTitle(e.drama.title, t))?.drama.posterPath ||
          null;
  }, [mounted, settings, version]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ring, recent, posterFor };
}

export default function VocabJourneyScreen() {
  const { mounted, loggedIn, reviewVersion, cloudVersion, wordbookVersion, profile, settings } = useApp();
  const plan = usePlan(loggedIn);
  const { ring, recent, posterFor } = useRings({
    mounted,
    profile,
    settings,
    version: `${reviewVersion}|${cloudVersion}|${wordbookVersion}`,
  });

  const data = useMemo(() => {
    if (!mounted) return null;
    const today = new Date();
    const ledger = loadStatsDaily();
    const days = statsByDay(ledger);
    return {
      grass: buildGrass(loadExpLedger(), today),
      days,
      dailyStart: statsStart(days),
      trend: buildTrend(days, today),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, reviewVersion, cloudVersion, ring]); // ring＝今日の行に円の値を残した後に推移を読み直す

  const grassOk = featureAccess('grass', plan).usable;
  const screenRef = useRef(null);

  // スマホでは円のカードを1画面に収める（ヘッダーと下のタブを除いた高さ＝--vj-avail）。
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return undefined;
    const fit = () => {
      const hdr = document.querySelector('header')?.getBoundingClientRect().height || 0;
      const nav = document.querySelector('nav.bottom-nav')?.getBoundingClientRect().height || 0;
      el.style.setProperty('--vj-avail', `${Math.max(420, window.innerHeight - hdr - nav)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [data]);

  // 円の下の内容（最近覚えた単語・学習した日・週ごとの推移）は、画面に入ったときに下からふわっと出す。
  useEffect(() => {
    const root = screenRef.current;
    if (!root) return undefined;
    const items = root.querySelectorAll('.vj-reveal');
    if (typeof IntersectionObserver === 'undefined') {
      items.forEach((x) => x.classList.add('is-in')); // 監視できない環境では最初から見せる（隠れたままにしない）
      return undefined;
    }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))),
      { threshold: 0.12 }
    );
    items.forEach((x) => io.observe(x));
    return () => io.disconnect();
  }, [data, ring, recent.length]);

  // 円をタップ → 円の下の内容へ動きつきで移る（動きを減らす設定では即座に）。
  const openRest = () => {
    const root = screenRef.current;
    const target = root?.querySelector('.vj-reveal');
    if (!target) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="vj-screen" ref={screenRef}>
      {data && (
        <div className="vj-body">
          {ring && canShowRings() && (
            <VocabRings
              values={ring.values}
              from={ring.from}
              glowFrom={ring.glowFrom}
              gain={ring.gain}
              recent={recent}
              posterFor={posterFor}
              onOpen={openRest}
              cue="タップで記録を見る ↓"
              restClassName="vj-reveal"
            />
          )}
          {grassOk && (
            <div className="vj-reveal">
              <GrassCard grass={data.grass} days={data.days} dailyStart={data.dailyStart} />
            </div>
          )}
          <div className="vj-reveal">
            <Trend trend={data.trend} plan={plan} />
          </div>
        </div>
      )}
    </div>
  );
}
