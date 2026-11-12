// 10枚でひと区切り（オーナー決定 2026-11-12・案5）の出す条件（純関数・テスト用）。
//   answered＝この回で採点した枚数（今の1枚を含む）・total＝この回の枚数・on＝設定（settings.reviewBreak !== false）・
//   shown＝この回で出し終えた所（戻るで取り消して答え直しても二度出さない）。最後の1枚の後は出さない（完了画面へ）。
export const REVIEW_BREAK_EVERY = 10;

export function shouldShowBreak(answered, total, on, shown = null) {
  if (!on) return false;
  if (!(answered > 0) || answered % REVIEW_BREAK_EVERY !== 0) return false;
  if (answered >= total) return false;
  if (shown && shown.has(answered)) return false;
  return true;
}
