// 「今日の復習」1回の語数（design-paid-features-2026-10-08「5.」）。
//   2026-10-08 オーナー決定で無料（PLAN_FEATURES.reviewCount='free'）＝誰でも settings.dailyReviewCount で
//   10／20／30／50／全部 から選べる。既定は DAILY_REVIEW_CAP（20）。
//   1日の上限ではなく1回の量＝終わったら次の回を続けられる（期日の来た語→未学習の語の順に出る）。
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
