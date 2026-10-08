'use client';

// 3重の円（ホーム）の数え方と描き方の決まり。docs/design-paid-features-2026-10-08.md「3重の円」「実装メモ 1」。
//   外＝出会った／中＝覚えた／内＝マスター。各値は「これまでの最高値」（cl_stats_daily の全行の max と
//   今の計算値の大きい方）＝忘れて判定が外れても円はしぼまない（罪悪感 UI を作らない）。
//   円弧の長さ＝語数÷段階の枠。段階の中では伸びるだけ、出会った語が段階を超えた時だけ一度短くなる。

import { recordStatsDailyRings, statsHighWater, loadStatsDaily } from './storage';

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
export function ringFractions(v) {
  const tier = ringTier(v.met);
  const f = (n) => Math.min(1, Math.max(0, n / tier));
  return { met: f(v.met), learned: f(v.learned), mastered: f(v.mastered) };
}

// 表示する値＝max(台帳の最高値, 今の計算値)。あわせて今日の行に最高値を残す（同期は max マージ）。
export function settleRingValues(current) {
  const hw = statsHighWater(loadStatsDaily());
  const v = {
    met: Math.max(hw.met, current.met || 0),
    learned: Math.max(hw.learned, current.learned || 0),
    mastered: Math.max(hw.mastered, current.mastered || 0),
  };
  recordStatsDailyRings(v);
  return v;
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
