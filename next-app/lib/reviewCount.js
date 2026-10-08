// 毎日の復習の語数（design-paid-features-2026-10-08「5.」・decision-pricing「復習とクイズの無料/有料」）。
//   無料＝「今日の復習」1日 DAILY_REVIEW_CAP（20）語で固定。
//   プラス＝設定 settings.dailyReviewCount で 10／20／30／50／全部 から選べる。
//   ★効くのは「今日の復習」の語数だけ（話ごと・マイ単語帳・マスター手前の復習には効かない）。
//   依存なしの純関数（node のテストから読む）。プラスかどうかは呼び出し側が featureAccess('reviewCount').usable で渡す。

export const DAILY_REVIEW_CAP = 20; // lib/storage.js の DAILY_REVIEW_CAP と同じ値（あちらが正典・テストで一致を確認）

// 'all' は「期日の来た語を全部」。
export const REVIEW_COUNT_OPTIONS = [10, 20, 30, 50, 'all'];

export function reviewCountLabel(v) {
  return v === 'all' ? '全部' : `${v}語`;
}

// 設定値を正規化（未設定・不正値は既定の20）。
export function normalizeReviewCount(v) {
  return REVIEW_COUNT_OPTIONS.includes(v) ? v : DAILY_REVIEW_CAP;
}

// 今日の復習の上限語数。usable=false（正式版の無料の人）は設定に関係なく 20。'all' は Infinity。
export function dailyReviewCap(settings, usable) {
  if (!usable) return DAILY_REVIEW_CAP;
  const v = normalizeReviewCount(settings?.dailyReviewCount);
  return v === 'all' ? Infinity : v;
}
