// 復習カードの大きな語を1行に収める大きさの計算（components/ReviewCinemaCard.js の useFitWord・2026-11-07）。
//   依存なしの純関数（node のテストから読む）。オーナー「長い単語が次の行にいっちゃうのはやめたい」。
//   最大＝CSS の大きさ、入らなければ実際の幅に合わせて縮める。下限でも入らない極端に長い句だけ折り返す。
export const FIT_MIN_PX = { front: 22, back: 20 };
export function fitFontSize(maxPx, naturalPx, availPx, minPx) {
  if (!(naturalPx > 0) || !(availPx > 0) || naturalPx <= availPx) return { size: maxPx, wrap: false };
  const size = Math.floor(((maxPx * availPx) / naturalPx) * 0.98); // 0.98＝測り誤差と字間のゆとり
  return size >= minPx ? { size, wrap: false } : { size: minPx, wrap: true };
}
