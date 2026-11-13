// ホームの「昨日の語」（2026-11-13 オーナー OK・法務は条件付き可）。♡ の語が無い日に、今の「今日の語」の札と同じ見た目で出す。
//   法務の条件（変えない）:
//   ・選び方は機械的に＝昨日学んだ語（SRS の lastReview が昨日）から、日付で1つ（同じ日は同じ語）。「印象的なセリフ」で選ばない・AI に選ばせない。
//   ・見出しは語。例文は “ ” と出所（作品名 SxE・字幕：OpenSubtitles）の従。
//   ・例文は単語リストの OpenSubtitles 由来（source === 'drama'）の語だけ。拡張機能で読んだ画面の字幕（my_words の sentence）・AI の作例は使わない。
//   ・昨日学んでいない人には出さない（null）。表を持たない純関数。
const norm = (s) => String(s ?? '').toLowerCase().trim();

// 昨日の日付（端末のローカル日付・YYYY-MM-DD）
export function yesterdayOf(todayKey) {
  const [y, m, d] = String(todayKey || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const t = new Date(y, m - 1, d - 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// 候補＝昨日学んだ語のうち、単語リスト（履歴）にあって OpenSubtitles の例文が付いている語。語ごとに1つ（最初に見つかった話）。
export function yesterdayCandidates(history, srs, todayKey) {
  const yKey = yesterdayOf(todayKey);
  if (!yKey) return [];
  const seen = new Set();
  const out = [];
  (history || []).forEach((h) => {
    (h?.words || []).forEach((w) => {
      const k = norm(w?.word);
      if (!k || seen.has(k)) return;
      const e = srs?.[k];
      if (!e || e.skipped || e.lastReview !== yKey) return;
      if (w.source !== 'drama' || !String(w.example || '').trim()) return;
      seen.add(k);
      out.push({
        word: w.word,
        ja: w.ja || w.definition || '',
        example: w.example,
        drama: h.drama || null,
        season: h.season ?? null,
        episode: h.episode ?? null,
      });
    });
  });
  return out.sort((a, b) => (norm(a.word) < norm(b.word) ? -1 : norm(a.word) > norm(b.word) ? 1 : 0));
}

// 日付で1つ（同じ日は同じ語）。候補が無ければ null＝札を出さない。
export function pickYesterdayWord(history, srs, todayKey) {
  const list = yesterdayCandidates(history, srs, todayKey);
  if (!list.length) return null;
  let h = 0;
  for (const c of String(todayKey || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}
