// 復習カードの大きな語を1行に収める大きさの計算（components/ReviewCinemaCard.js の useFitWord・2026-11-07）。
//   依存なしの純関数（node のテストから読む）。オーナー「長い単語が次の行にいっちゃうのはやめたい」。
//   最大＝CSS の大きさ、入らなければ実際の幅に合わせて縮める。下限でも入らない極端に長い句だけ、空白で折り返す。
//   ★語の途中では絶対に折らない（オーナー 2026-11-07「reconnaissan / ce」の実例）: 空白の無い1語は下限より小さくしてでも1行に。
export const FIT_MIN_PX = { front: 22, back: 20 };
export const FIT_FLOOR_PX = 12; // 1語を1行に収めるために下限を割る時の、それ以上は小さくしない値
const shrink = (px, avail, natural) => Math.floor(((px * avail) / natural) * 0.98); // 0.98＝測り誤差と字間のゆとり
export function fitFontSize(maxPx, naturalPx, availPx, minPx, hasSpace = true) {
  if (!(naturalPx > 0) || !(availPx > 0) || naturalPx <= availPx) return { size: maxPx, wrap: false };
  const size = shrink(maxPx, availPx, naturalPx);
  if (size >= minPx) return { size, wrap: false };
  if (!hasSpace) return { size: Math.max(FIT_FLOOR_PX, size), wrap: false };
  return { size: minPx, wrap: true };
}
// 空白で折り返した後も、句の中の1語が幅を超えていたら（語の途中で折らないために）その語が入るまで縮める
export function fitWrappedSize(sizePx, widestPx, availPx) {
  if (!(widestPx > availPx) || !(availPx > 0)) return sizePx;
  return Math.max(FIT_FLOOR_PX, shrink(sizePx, availPx, widestPx));
}
