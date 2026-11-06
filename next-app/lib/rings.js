'use client';

// 3重の円（ホーム）の数え方と描き方の決まり。docs/design-paid-features-2026-10-08.md「3重の円」「実装メモ 1」。
//   外＝出会った／中＝覚えた／内＝マスター。各値は「これまでの最高値」（cl_stats_daily の全行の max と
//   今の計算値の大きい方）＝忘れて判定が外れても円はしぼまない（罪悪感 UI を作らない）。
//   円弧の長さ＝語数÷段階の枠。段階の中では伸びるだけ、出会った語が段階を超えた時だけ一度短くなる。
//   枠は下がらない（2026-11-07）: コレクションから作品を消去して「出会った」が減っても、枠は台帳の最高値から決める＝
//   出会ったの弧だけ短くなり、覚えた・マスターの弧は語数どおり動かない（「覚えた・マスターはこれまでどおり」）。

import { recordStatsDailyRings, statsHighWater, loadStatsDaily, loadRingMetReset, saveRingMetReset } from './storage';
import { ringMetValue } from './workRemoval';

// 円の有料/無料は保留（オーナー 2026-10-08・全部完成してから決める）＝無料で固定しない。
// 有料にすると決めたらここを true にし、呼び出し側から isPro（【A】土台）を渡す。
export const RINGS_REQUIRE_PRO = false;
export function canShowRings(isPro = true) {
  return !RINGS_REQUIRE_PRO || !!isPro;
}

// 段階の枠（出会った語数が収まる最小の段階）。
export const RING_TIERS = [100, 250, 500, 1000, 2000, 4000, 8000, 16000];
export function ringTier(met) {
  return RING_TIERS.find((t) => met <= t) ?? RING_TIERS[RING_TIERS.length - 1];
}
// tier を省くと v.tier（settleRingValues が付ける・台帳の最高値から決めた枠）、それも無ければ v.met から決める。
//   動きの途中の値（from / glowFrom は tier を持たない）は、呼び出し側が今の値の枠を渡して同じ枠で描く。
export function ringFractions(v, tier = v.tier || ringTier(v.met)) {
  const f = (n) => Math.min(1, Math.max(0, n / tier));
  return { met: f(v.met), learned: f(v.learned), mastered: f(v.mastered) };
}

// 表示する値＝max(台帳の最高値, 今の計算値)。あわせて今日の行に最高値を残す（同期は max マージ）。
//   「出会った」だけは、利用者が自分でコレクションから作品を消去したら減ってよい（オーナー 2026-11-07）＝
//   消去した時点からの最高値（cl_ring_met_reset）を使う。「覚えた・マスター」は今までどおり縮まない。
export function settleRingValues(current) {
  const hw = statsHighWater(loadStatsDaily());
  const reset = loadRingMetReset();
  const met = ringMetValue({ current: current.met, highWater: hw.met, reset });
  if (reset && met !== reset.met) saveRingMetReset({ at: reset.at, met });
  const v = {
    met,
    learned: Math.max(hw.learned, current.learned || 0),
    mastered: Math.max(hw.mastered, current.mastered || 0),
  };
  recordStatsDailyRings(v);
  // 枠＝これまでの「出会った」の最高値（台帳）と今の値の大きい方で決める＝消去で met が減っても枠は縮まない。
  return { ...v, tier: ringTier(Math.max(hw.met, met)) };
}

// 「前回見た値」（開いた時に前回→今へ広がる動きの起点）。端末ごと・同期しない。
const RING_SEEN_KEY = 'cl_ring_seen';
export function loadRingSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(RING_SEEN_KEY));
    return v && typeof v === 'object' && Number.isFinite(v.met) ? v : null;
  } catch {
    return null;
  }
}
export function saveRingSeen(v) {
  try {
    localStorage.setItem(
      RING_SEEN_KEY,
      JSON.stringify({ met: v.met, learned: v.learned, mastered: v.mastered, at: Date.now() })
    );
  } catch {
    /* プライベートモード等は諦める（毎回「動きなし」で出るだけ） */
  }
}
