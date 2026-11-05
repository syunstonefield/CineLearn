// user_state の合算規則のうち、2026-11-05 に同期対象へ足した3項目（lib/supabase.js mergeStateValue が使う・純関数）。
//   ログアウトで端末の学習データを消すようにしたため（lib/deviceAccount.js）、クラウドに写しの無かった記録が
//   同じアカウントの入り直しで戻らなくなる＝この3つを同期して戻るようにする。別端末との合算にもそのまま使う。
//   * cl_activity_dates … 学習した日（連続日数の元）。日付の和集合・昇順・直近 ACTIVITY_MAX 日。
//   * cl_review_log     … 復習セッションの記録。「日付|historyId|sessionNum」で同一視して和集合・日付順・直近 REVIEW_LOG_MAX 件。
//   * cl_quiz_exp_awarded … 視聴後クイズの EXP を付けた問題の台帳（historyId → 語）。historyId ごとの語の和集合。
//     同期することで、入り直し・別端末で同じ問題に EXP が二重に付かなくなる（従来は端末ごとに1回ずつ）。
export const ACTIVITY_MAX = 400;
export const REVIEW_LOG_MAX = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function mergeActivityDates(localV, cloudV) {
  const set = new Set();
  for (const v of [...(Array.isArray(cloudV) ? cloudV : []), ...(Array.isArray(localV) ? localV : [])]) {
    if (typeof v === 'string' && DATE_RE.test(v)) set.add(v);
  }
  return [...set].sort().slice(-ACTIVITY_MAX);
}

const sessionKey = (s) => `${s.date}|${s.historyId ?? ''}|${s.sessionNum ?? ''}`;
export function mergeReviewLog(localV, cloudV) {
  const m = new Map();
  for (const s of [...(Array.isArray(cloudV) ? cloudV : []), ...(Array.isArray(localV) ? localV : [])]) {
    if (!s || typeof s !== 'object' || typeof s.date !== 'string') continue;
    m.set(sessionKey(s), s); // 同じセッションはローカル（後勝ち）を採る
  }
  return [...m.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.sessionNum || 0) - (b.sessionNum || 0)))
    .slice(-REVIEW_LOG_MAX);
}

export function mergeQuizAwarded(localV, cloudV) {
  const out = {};
  const add = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [hid, words] of Object.entries(obj)) {
      if (!Array.isArray(words)) continue;
      const set = new Set(out[hid] || []);
      for (const w of words) if (typeof w === 'string' && w) set.add(w.toLowerCase());
      out[hid] = [...set];
    }
  };
  add(cloudV);
  add(localV);
  return out;
}
