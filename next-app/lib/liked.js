// ♡＝お気に入りの例文の印（2026-11-07・オーナー決定・法務 条件付きOK）。表を持たない純関数。
//   ♡は「例文のある語」に付ける印（my_words.liked）。文は既存の sentence をそのまま使い、書き換えない。
//   見せる時は語が見出し・例文は “ ” と 📺作品 SxE（字幕：OpenSubtitles）付きの従（lib/words.js の wordSource と同じ）。
//   1話あたり LIKE_CAP_PER_EPISODE 件まで。利用者をまたいだ集計はしない（端末内の自分の語だけ）。
export const LIKE_CAP_PER_EPISODE = 10;

const norm = (s) => String(s ?? '').toLowerCase().trim();
const defaultSameTitle = (a, b) => !!a && !!b && norm(a) === norm(b);

// その話で ♡ を付けた語（上限の判定用）。映画・話数不明（S/E が null）は作品一致だけで数える。
export function likedInEpisode(words, { dramaTitle, season = null, episode = null } = {}, sameTitle = defaultSameTitle) {
  return (words || []).filter(
    (w) =>
      w?.liked === true &&
      sameTitle(w.dramaTitle, dramaTitle) &&
      (w.season ?? null) === (season ?? null) &&
      (w.episode ?? null) === (episode ?? null)
  );
}

export function canLikeMore(words, ep, sameTitle) {
  return likedInEpisode(words, ep, sameTitle).length < LIKE_CAP_PER_EPISODE;
}

// ♡ の付いた語（例文のある語だけ・新しい順）
export function likedWords(words) {
  return (words || [])
    .filter((w) => w?.liked === true && String(w.sentence || w.example || '').trim())
    .sort((a, b) => (String(b.likedAt || '') > String(a.likedAt || '') ? 1 : String(b.likedAt || '') < String(a.likedAt || '') ? -1 : norm(a.word) < norm(b.word) ? -1 : 1));
}

// ホームの「今日の語」＝♡の語から日付で1つ（同じ日は同じ語・語が無ければ null）
export function pickTodayWord(words, dateStr) {
  const list = likedWords(words).slice().sort((a, b) => (norm(a.word) < norm(b.word) ? -1 : 1));
  if (!list.length) return null;
  let h = 0;
  for (const c of String(dateStr || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}
