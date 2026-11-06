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
