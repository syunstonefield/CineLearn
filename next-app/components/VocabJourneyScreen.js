'use client';

// あゆみタブ（下のタブ・オーナー 2026-10-08 で「円のタップ先」から変更）。
// docs/design-paid-features-2026-10-08.md「実装メモ 4」・モック https://claude.ai/artifact/NYPowDEgA8ceU7vM7YCfem 。
//   上から 題「あゆみ」＋「正式版ではプラス」（1か所だけ）→ 3重の円と数字の札・最近覚えた単語（VocabRings）→「段階ごとの覚えた語」（CEFR 目安別・オーナー 2026-11-05）
//   →「学習した日」（草）→「週ごとの推移」。2026-11-10 見直し（受付の見本 reports/journey-ui-2026-11-10/mock.html・オーナー了承）:
//   円のカードで1画面を占めない・札は白地／細い枠／角 12px（単語リストとそろえる）・推移は目盛り1本＋棒は下の段・凡例3行はやめる。
//   円の有料/無料は保留（PLAN_FEATURES.ring・canShowRings）＝このタブの中で後から出し分けられる。
//   数え方・しきい値・文言は lib/journey.js の JOURNEY に集約（ここは描くだけ）。
//   罪悪感 UI を作らない: 空いた日は薄い色・連続日数／休んだ日数は出さない・下がった週を赤くしない。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import VocabRings from './VocabRings';
import GrassCard from './GrassCard';
import PlusNote from './PlusNote';
import CefrNote from './CefrNote';
import { trackUsage } from '@/lib/usage';
import { featureAccess, usePlan } from '@/lib/plan';
import { canShowRings, loadRingSeen, saveRingSeen, settleRingValues } from '@/lib/rings';
import { loadExpLedger } from '@/lib/exp';
import { buildLibraryEntries, collectRingWords, loadHistory, loadSrs, loadStatsDaily, ringCounts, statsByDay } from '@/lib/storage';
import { getActiveWords, sameWorkTitle } from '@/lib/words';
import { JOURNEY, buildGrass, buildTrend, md, niceMax, statsStart } from '@/lib/journey';
import { countLearnedByLevel } from '@/lib/journeyCefr';

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

// 目盛りの刻み（0 と3本の線が切りのよい数になるように）。上限＝刻み×3。
const TREND_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
function trendStep(max) {
  return TREND_STEPS.find((s) => max <= s * 3) || TREND_STEPS[TREND_STEPS.length - 1];
}

// 週ごとの推移（2026-11-10 見直し）: 目盛りは左の1本（線＝覚えた・マスターの累計・線の右端に名前と数字）。
//   棒（その週に思い出せた数）は下の別の段に分ける（目盛りなし・段の見出しだけ）。凡例はやめる。
function TrendChart({ series }) {
  const [boxRef, boxW] = useBoxWidth(640);
  const W = Math.max(280, Math.min(760, boxW));
  const Lp = 34; // 左の目盛り
  const R = 64; // 線の右端の名前と数字
  const T0 = 10;
  const LH = 128; // 線の段
  const GAP = 30; // 棒の段の見出し
  const BH = 46; // 棒の段
  const XL = 20; // 週の目盛り
  const H = T0 + LH + GAP + BH + XL;
  const n = series.length;
  const learned = series.map((s) => s.learned);
  const mastered = series.map((s) => s.mastered);
  const ok = series.map((s) => s.ok);
  const step = trendStep(Math.max(1, ...learned, ...mastered));
  const yMax = step * 3;
  const okMax = Math.max(1, ...ok);
  const x = (i) => Lp + ((i + 0.5) * (W - Lp - R)) / n;
  const y = (v) => T0 + LH * (1 - v / yMax);
  const base = T0 + LH + GAP + BH;
  const bh = (v) => (BH * v) / okMax;
  const bw = Math.min(14, ((W - Lp - R) / n) * 0.5);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - Lp - R) / 64))));
  const last = n - 1;
  const gL = learned[last] - learned[0];
  const gM = mastered[last] - mastered[0];
  const summary = T.trendSummary(n, gL, gM);
  // 右端の名前と数字（覚えた＝上・マスター＝下。近すぎる時はマスターを下へずらす）
  const yL = y(learned[last]);
  const yM = Math.max(y(mastered[last]), yL + 30);

  return (
    <div ref={boxRef} className="vj-chartbox">
      <svg
        className="vj-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${n}週間の推移。覚えた ${learned[0]}語から ${learned[last]}語、マスター ${mastered[0]}語から ${mastered[last]}語へ`}
      >
        {[0, 1, 2, 3].map((g) => {
          const gy = y(step * g);
          return (
            <g key={g}>
              <line x1={Lp} x2={W - R} y1={gy} y2={gy} className="vj-grid" />
              <text x={Lp - 6} y={gy + 3.5} textAnchor="end" className="vj-axis">
                {step * g}
              </text>
            </g>
          );
        })}
        <path d={`${path(learned)} L${x(last)} ${T0 + LH} L${x(0)} ${T0 + LH} Z`} className="vj-area" />
        <path d={path(learned)} fill="none" className="vj-line-learned" strokeWidth="2.5" strokeLinejoin="round" />
        <path d={path(mastered)} fill="none" className="vj-line-mastered" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx={x(last)} cy={y(learned[last])} r="3.5" className="vj-dot-learned" strokeWidth="1.5" />
        <circle cx={x(last)} cy={y(mastered[last])} r="3.5" className="vj-dot-mastered" strokeWidth="1.5" />
        <text x={x(last) + 8} y={yL + 1} className="vj-endlabel">
          覚えた
        </text>
        <text x={x(last) + 8} y={yL + 14} className="vj-endlabel vj-endnum">
          {learned[last]}
        </text>
        <text x={x(last) + 8} y={yM + 1} className="vj-endlabel">
          マスター
        </text>
        <text x={x(last) + 8} y={yM + 14} className="vj-endlabel vj-endnum">
          {mastered[last]}
        </text>

        <text x={Lp} y={T0 + LH + GAP - 9} className="vj-axis">
          その週に思い出せた数
        </text>
        {ok.map((v, i) =>
          v > 0 ? <rect key={i} x={x(i) - bw / 2} y={base - bh(v)} width={bw} height={bh(v)} rx="2.5" className="vj-bar" /> : null
        )}
        <line x1={Lp} x2={W - R} y1={base + 0.5} y2={base + 0.5} className="vj-grid" />
        {series.map((s, i) =>
          (last - i) % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={H - 5} textAnchor="middle" className="vj-axis">
              {md(s.weekStart)}週
            </text>
          ) : null
        )}
      </svg>
      {summary && <p className="vj-hint">{summary}</p>}
    </div>
  );
}

function Trend({ trend, plan }) {
  const a = featureAccess('trend', plan);
  // 利用データ: 週ごとの推移が画面に半分以上出たら1回（開くたびに1回まで・正式版の無料の人の説明文は数えない）。
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || a.locked || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          trackUsage('trend_seen');
          io.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [a.locked]);
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
        <p>{T.trendWait(minW, trend.start ? md(trend.start) : '今日')}</p>
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
    <section className="vj-card" aria-labelledby="vj-trend-h" ref={ref}>
      {/* 「正式版ではプラス」は画面の上の1か所だけ（2026-11-10 見直し） */}
      <div className="vj-ch">
        <h3 id="vj-trend-h">{T.trendTitle}</h3>
      </div>
      {body}
    </section>
  );
}

// 段階ごとの覚えた語（CEFR 目安別・案A 横棒・分母なし）。数え方は lib/journeyCefr.js。
//   出さないもの: 割合・残り・表の語数との比較・本人の段階。棒は最多の段階を 1 とした相対値。
//   注記は単語リスト・単語帳と同じ CefrNote を1か所（文は変えない）＋その外に「目安の付かない語（句動詞など）は含みません」の1行（法務 2026-11-05）。
//   第1版は「いまの目安」（11月末）と統合しない・段階のタップで語を一覧しない（法務 2026-11-05）。
function CefrCard({ cefr }) {
  // 利用データ: カードが画面に半分以上出たら1回（開くたびに1回まで）
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          trackUsage('journey_cefr_seen');
          io.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const pct = (f) => `${Math.round(Math.min(1, Math.max(0, f)) * 1000) / 10}%`;
  return (
    <section className="vj-card vj-cefr" aria-labelledby="vj-cefr-h" ref={ref}>
      <div className="vj-ch">
        <h3 id="vj-cefr-h">{T.cefrTitle}</h3>
        <span className="vj-hint">{T.cefrSub}</span>
      </div>
      <div className="vj-cefr-rows" role="list">
        {cefr.rows.map((r) => (
          <div
            key={r.level}
            className={`vj-cefr-row${r.learned ? '' : ' is-empty'}`}
            role="listitem"
            aria-label={`${r.level} 覚えた ${r.learned}語${r.mastered ? `、うち マスター ${r.mastered}語` : ''}`}
          >
            <span className="vj-cefr-lv">{r.level}</span>
            <div className="vj-cefr-bar" aria-hidden="true">
              {r.learned > 0 && <i style={{ width: pct(r.frac) }} />}
              {r.mastered > 0 && <b style={{ width: pct(r.fracMastered) }} />}
            </div>
            <span className="vj-cefr-n">{r.learned}</span>
          </div>
        ))}
      </div>
      {/* 凡例の「うち マスター」は、棒にマスターが1語でも出てから（2026-11-10 見直し） */}
      <div className="vj-legend">
        <span>
          <i className="vj-key-learned" />
          {T.cefrLearned}
        </span>
        {cefr.rows.some((r) => r.mastered > 0) && (
          <span>
            <i className="vj-key-mastered" />
            {T.cefrMastered}
          </span>
        )}
      </div>
      {/* 法務 2026-11-05: CefrNote はそのまま1か所、その外に固定の1行（語数は出さない） */}
      <p className="vj-hint">{T.cefrNone}</p>
      <CefrNote />
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

  // 段階ごとの覚えた語（保存語の段階は端末の履歴から借りる＝loadHistory を渡す）
  const cefr = useMemo(() => (words ? countLearnedByLevel(words, loadHistory()) : null), [words]);

  return { ring, recent, posterFor, cefr };
}

export default function VocabJourneyScreen() {
  const { mounted, loggedIn, reviewVersion, cloudVersion, wordbookVersion, profile, settings, journeyFocus, setJourneyFocus } = useApp();
  const plan = usePlan(loggedIn);
  const { ring, recent, posterFor, cefr } = useRings({
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

  // ホームの「学習した日」から来た時は、学習した日の欄へ移る（オーナー 2026-10-08）。
  useEffect(() => {
    if (journeyFocus !== 'grass' || !data) return undefined;
    const t = setTimeout(() => {
      const el = screenRef.current?.querySelector('#vj-grass-sec');
      if (el) {
        el.classList.add('is-in');
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }
      setJourneyFocus(null);
    }, 120);
    return () => clearTimeout(t);
  }, [journeyFocus, data, setJourneyFocus]);

  // 「前回から…」の行を押す → 最近覚えた単語へ動きつきで移る（動きを減らす設定では即座に）。
  const openRest = () => {
    const root = screenRef.current;
    const target = root?.querySelector('.vr-recent');
    if (!target) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const ringAccess = featureAccess('ring', plan);
  // 正式版の無料の人（下のタブには出ない・念のため）: 説明だけ（ぼかし・チラ見せはしない）
  if (ringAccess.locked) {
    return (
      <div className="vj-screen" ref={screenRef}>
        <div className="vj-card">
          <PlusNote feature="ring" plan={plan} />
          <p className="vj-hint">あゆみ（3重の円・段階ごとの覚えた語・学習した日のカレンダー・週ごとの推移）はプラスの機能です。覚えた語・マスターの数はホームと復習タブでいつでも見られます。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="vj-screen" ref={screenRef}>
      <div className="vj-head">
        <h1 className="screen-title">あゆみ</h1>
        {ringAccess.betaNote && <PlusNote feature="ring" plan={plan} />}
      </div>
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
              restClassName="vj-reveal"
            />
          )}
          {cefr?.show && (
            <div className="vj-reveal">
              <CefrCard cefr={cefr} />
            </div>
          )}
          {grassOk && (
            <div className="vj-reveal" id="vj-grass-sec">
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
