// 復習一覧（ReviewHubScreen）のスクロール位置の受け渡し（オーナー 2026-10-20）。
// 一覧から 復習／クイズ／リスト に移ると一覧は閉じられ、戻ると画面切替の決まりで最上部から
// 表示し直される（AppProvider の scrollTo(0,0)）。押した瞬間の位置をここに預け、戻った一覧が
// 中身をそろえてから取り出して戻す。下タブから入り直した時（openReviewHub）は捨てる＝従来どおり最上部。
// メモリ上だけ（リロードで消えてよい）。

let saved = null;

export function rememberHubScroll() {
  if (typeof window !== 'undefined') saved = window.scrollY;
}

// 1回だけ取り出す（2回目以降は null）。
export function takeHubScroll() {
  const y = saved;
  saved = null;
  return y;
}

export function forgetHubScroll() {
  saved = null;
}
