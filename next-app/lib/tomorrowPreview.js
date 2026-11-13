// 復習完了の画面の「明日 復習できる単語 N個」（オーナー決定 2026-11-12・戻ってきてもらう工夫）の数え方（純関数）。
//   * 数えるのは、この回で答えた語のうち、SRS の実際の値で明日（次の日）に今日の復習へ出る語だけ。
//     ＝外していない・マスター前（isDue と同じ条件）で、dueDate が明日以前。
//     今日の復習で答えた語は、知らなかった／うろ覚え／初めての知ってた が明日（interval 1）。
//     練習扱い（同じ日の2回目の成功・もう一度の成功）で日程が動かなかった語も、残っている dueDate で数える。
//   * 0 の時は画面に出さない（呼び出し側）。急がせる言い方（あと○語・忘れる前に）はしない。
// 依存なし（node のテストから読む）。マスターの条件は lib/storage.js の isMastered と同じ。

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function tomorrowStr(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return localDateStr(d);
}

const isMastered = (e) => !!e && !e.skipped && e.repetitions >= 3 && e.interval >= 21 && e.easeFactor >= 2.0;

function isDueBy(e, tomorrow) {
  if (!e || e.skipped || isMastered(e)) return false;
  return !e.dueDate || e.dueDate <= tomorrow;
}

// 明日の予告の下の文（外の AI の感想・オーナー OK 2026-11-13）: この回の語を1つ入れる＝「明日、leverage などをもう一度思い出してみましょう」。
//   効果の言い切り（定着・覚えやすくなる・忘れにくい）と急がせる言い方（忘れる前に・あと○語）は使わない。語は英語の見出しのまま。
//   語が取れない時は null（呼び出し側は今までの文 TOMORROW_FALLBACK のまま）。
export const TOMORROW_FALLBACK = '1日あけて思い出すと、覚えやすくなります';
export function pickDueTomorrowWord(words, srs, now = new Date()) {
  const tomorrow = tomorrowStr(now);
  for (const w of words || []) {
    const word = String(w?.word || '').trim();
    if (word && isDueBy(srs?.[word.toLowerCase()], tomorrow)) return word;
  }
  return null;
}
export function tomorrowSubLine(word, count) {
  if (!word) return TOMORROW_FALLBACK;
  return count > 1 ? `明日、${word} などをもう一度思い出してみましょう` : `明日、${word} をもう一度思い出してみましょう`;
}

// words: この回で答えた語（{word} の配列・重複可）。srs: loadSrs() の値。
export function countDueTomorrow(words, srs, now = new Date()) {
  const tomorrow = tomorrowStr(now);
  const seen = new Set();
  let n = 0;
  for (const w of words || []) {
    const k = String(w?.word || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (isDueBy(srs?.[k], tomorrow)) n++;
  }
  return n;
}
