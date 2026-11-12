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

// words: この回で答えた語（{word} の配列・重複可）。srs: loadSrs() の値。
export function countDueTomorrow(words, srs, now = new Date()) {
  const tomorrow = tomorrowStr(now);
  const seen = new Set();
  let n = 0;
  for (const w of words || []) {
    const k = String(w?.word || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const e = srs?.[k];
    if (!e || e.skipped || isMastered(e)) continue;
    if (!e.dueDate || e.dueDate <= tomorrow) n++;
  }
  return n;
}
