// 「この回の別の場面」（/api/example otherScene）の語の縛り（2026-10-31 法務 要修正1）。
//   回全体から1文を引く前に、ログイン中の本人の my_words（クラウド）に「同じ作品・同じ話のその語」があることを確かめる。
//   ＝本人が実際に保存した語でしか回全体を探せない（語を変えて字幕全文を1文ずつ復元する総当りを、保存という行為で縛る）。
//   読みは本人の JWT＋anon 鍵（RLS で本人の行だけ）。service_role は使わない。
//   取れない・不調・形が合わないは false（＝呼び出し側は従来の応答に倒れる・fail-closed）。
// seed・node:test から import できるよう相対 import だけを使う。作品名→TMDB ID の解決は呼び出し側から渡す（resolve）。
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants.js';

// 作品名の比較用（大小・記号・空白の揺れを吸収）。一致しなければ resolve で TMDB ID を突き合わせる。
function normTitle(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

export async function userSavedWordInEpisode(
  { token, uid, word, tmdbId, isMovie, season, episode, title },
  { fetchImpl = fetch, resolve } = {}
) {
  if (!token || !uid || !word || !tmdbId) return false;
  // ilike のワイルドカード・PostgREST の区切り文字を含む語は照会しない（完全一致の意味が崩れる）
  if (/[%_*\\,()]/.test(word)) return false;
  let rows;
  try {
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/my_words?user_id=eq.${encodeURIComponent(uid)}&word=ilike.${encodeURIComponent(word)}&select=drama_title,season,episode&limit=5`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return false;
    rows = await res.json();
  } catch {
    return false;
  }
  if (!Array.isArray(rows) || !rows.length) return false;
  for (const r of rows) {
    if (!r?.drama_title) continue;
    const sameEp = isMovie
      ? r.season == null && r.episode == null
      : Number(r.season) === Number(season) && Number(r.episode) === Number(episode);
    if (!sameEp) continue;
    if (title && normTitle(r.drama_title) === normTitle(title)) return true;
    if (typeof resolve !== 'function') continue;
    try {
      if (Number(await resolve(r.drama_title, isMovie)) === Number(tmdbId)) return true;
    } catch {
      /* 解決できない作品名は一致と見なさない */
    }
  }
  return false;
}
