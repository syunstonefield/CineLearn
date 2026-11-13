// 毎日の通知（app/api/push-notify）の日付と「最近使っている人」の判定（2026-11-13 見直し・純関数＝node のテストから読む）。
//   * srs_data の due_date／last_review は端末の日付（日本の利用者は日本時間）で入っている（lib/storage.js localDateStr）。
//     朝7時 JST の実行は 22:00 UTC＝前の日なので、UTC の日付で比べると日本の「きのう」になる → 日本時間の今日で比べる。
//   * 夕方は、直近3日（今日・きのう・おととい）に復習か学習の記録がある人だけに送る。利用統計（usage_daily）は使わない
//     （統計は目的を限っている）。その人自身の学習データ: srs_data の最後の復習日と、history の最後の更新。

export const RECENT_DAYS = 3;

// 日本時間の日付（YYYY-MM-DD）。
export function jstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function shiftDate(day, n) {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
// 直近 RECENT_DAYS 日の始まり（日本時間の日付と、その 0:00 JST を UTC の ISO で）
export function recentSince(now = new Date(), days = RECENT_DAYS) {
  const day = shiftDate(jstDate(now), -(days - 1));
  return { day, iso: new Date(`${day}T00:00:00+09:00`).toISOString() };
}
// lastReview: srs_data の最後の last_review（日付）／lastHistoryAt: history の最後の updated_at（時刻）
export function isRecentlyActive({ lastReview = null, lastHistoryAt = null } = {}, now = new Date(), days = RECENT_DAYS) {
  const since = recentSince(now, days);
  if (lastReview && String(lastReview).slice(0, 10) >= since.day) return true;
  if (lastHistoryAt && new Date(lastHistoryAt).getTime() >= new Date(since.iso).getTime()) return true;
  return false;
}
// 購読の朝・夕方の選択（列が無い古い DB・未設定は受け取る＝今までどおり）
export function wantsKind(sub, kind) {
  return sub?.[kind] !== false;
}
// PostgREST の Content-Range（"0-0/839" や "*/0"）から全体の数
export function countFromRange(v) {
  const n = Number(String(v || '').split('/')[1]);
  return Number.isFinite(n) ? n : 0;
}
