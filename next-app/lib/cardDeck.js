// 作品を選んだあとのカード（2026-11-12 オーナー決定・カード中心）。依存なしの純関数（node のテストから読む）。
//   * 出す語: この話の単語リストの語から、「知ってる」で外した語（SRS の skipped）と、もう答えて期日がまだ来ていない語を除く。
//     並びは予習と同じ（lib/prep.js orderWordsForPrep＝新出を先・その中はレベルの高い順）。
//   * 枚数: その端末で初めてのカードは5枚。2回目からは設定「予習で最初に見る語数」（15／30／全部・既定15）。
//     終わりの画面の「残りの単語も見る」は、その話の残りを最後まで（10語ごとの区切りつき・2026-11-12 オーナー決定）。
//   * 答えは復習と同じ SRS に入る（今日の復習の「初めて復習する語は1日20語」の上限とは別＝本人がこの話を選んで答えるため）。
import { orderWordsForPrep } from './prep.js';

export const CARDS_FIRST_COUNT = 5;
export const CARDS_FIRST_DONE_KEY = 'cl_cards_first_done';

function isDueEntry(e, today) {
  if (!e || !e.dueDate) return true;
  return e.dueDate <= today;
}

// 出せる語（並び済み）。srs: loadSrs() の値。today: 'YYYY-MM-DD'（端末の日付）。
export function cardCandidates(words, srs = {}, today = '') {
  const s = srs || {};
  const pool = (Array.isArray(words) ? words : []).filter((w) => {
    const e = s[String(w?.word || '').toLowerCase()];
    if (!w?.word) return false;
    if (e?.skipped) return false;
    if (e && !isDueEntry(e, today)) return false; // もう答えて、次の期日がまだ
    return true;
  });
  return orderWordsForPrep(pool, s);
}

// 1回に出す枚数。first=その端末で初めて／setting=settings.prepCoreCount（0＝全部）／rest=「残りの単語も見る」
export function cardCount({ first = false, setting = 15, rest = false } = {}) {
  if (rest) return null; // 残りを最後まで
  if (first) return CARDS_FIRST_COUNT;
  if (setting === 0) return null; // 全部
  return setting > 0 ? setting : 15;
}

export function takeCards(candidates, n) {
  const list = Array.isArray(candidates) ? candidates : [];
  return n == null ? list : list.slice(0, n);
}

// この話の語のうち、答えた（SRS に記録があり、外していない）語の数
export function seenCount(words, srs = {}) {
  const s = srs || {};
  return (Array.isArray(words) ? words : []).filter((w) => {
    const e = s[String(w?.word || '').toLowerCase()];
    return !!e && !e.skipped;
  }).length;
}
