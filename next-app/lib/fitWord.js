// 復習カードの大きな語の大きさ（components/ReviewCinemaCard.js の useFitWord・2026-11-07）。
//   依存なしの純関数（node のテストから読む）。
//   オーナーの意図（2026-11-07 訂正）: 1語が長くて語の途中で切れる（reconnaissan / ce）のをやめたい。
//   複数の語が空白で2行に分かれるのは構わない。
//   → 句は今の大きさのまま空白でだけ折り返す（語の途中では折らない・CSS）。縮めるのは、いちばん長い1語が
//     カードの幅に入らない時だけで、その語が1行に入る大きさまで（それ以上は小さくしない値＝FIT_FLOOR_PX）。
export const FIT_FLOOR_PX = 12;
export function fitLongestWord(maxPx, widestPx, availPx) {
  if (!(widestPx > 0) || !(availPx > 0) || widestPx <= availPx) return maxPx;
  const size = Math.floor(((maxPx * availPx) / widestPx) * 0.98); // 0.98＝測り誤差と字間のゆとり
  return Math.max(FIT_FLOOR_PX, size);
}

// 句（空白を含む）は2行に収まる大きさまで縮める（オーナー 2026-11-07「可能なら2行に収まるようにして」）。
//   上限＝今の大きさ（1語を入れるために縮めた後の大きさ）。下限＝PHRASE_MIN_PX。下限でも2行に入らない長い句だけ
//   下限の大きさで3行以上を許す。語の途中では折らない・空白でだけ折る、は CSS のまま。
//   linesAt(px)＝その大きさで描いた時の行数（部品側が実際に描いて数える）。行数は大きさを下げると増えない前提で二分探索。
export const PHRASE_MIN_PX = { front: 28, back: 22 };
export const PHRASE_MAX_LINES = 2;
export function fitPhraseLines(startPx, minPx, linesAt, maxLines = PHRASE_MAX_LINES) {
  if (!(startPx > 0) || linesAt(startPx) <= maxLines) return startPx;
  const lo0 = Math.min(minPx, startPx);
  if (linesAt(lo0) > maxLines) return lo0; // 下限でも入らない＝3行以上を許す
  let lo = lo0; // 収まる
  let hi = startPx; // 収まらない
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (linesAt(mid) <= maxLines) lo = mid;
    else hi = mid;
  }
  return lo;
}
