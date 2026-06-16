'use client';

// タイトル検索のユーティリティ（ダッシュボードの検索ボックス／検索結果画面で共用）。
// TMDB search_multi（映画＋TV横断）と、AIで検索語を解釈してから確認する2経路を提供する。
import { aiResolveTitles } from './recommend';

const tmdbImg = (p, size) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

// TMDBの1結果（映画/TV）を候補オブジェクトに正規化
export function mapTmdbResult(r) {
  const isMovie = r.media_type === 'movie';
  const en = isMovie ? r.original_title || r.title : r.original_name || r.name;
  const loc = isMovie ? r.title : r.name;
  const date = isMovie ? r.release_date : r.first_air_date;
  return {
    tmdbId: r.id,
    mediaType: r.media_type, // 'movie' | 'tv'
    title: en,
    englishTitle: en,
    localizedTitle: loc,
    year: (date || '').slice(0, 4),
    posterPath: tmdbImg(r.poster_path, 'w185'),
  };
}

// 関連度スコア：人気×投票数を基礎に、タイトル一致とポスター有無で補正してノイズを後ろへ
function scoreTmdbResult(r, ql) {
  const isMovie = r.media_type === 'movie';
  const en = (isMovie ? r.original_title || r.title : r.original_name || r.name || '').toLowerCase();
  let s = (r.popularity || 0) * Math.log10((r.vote_count || 0) + 10);
  if (en === ql) s *= 6;
  else if (en.startsWith(ql)) s *= 2.5;
  else if (en.includes(ql)) s *= 1.3;
  s *= r.poster_path ? 1.5 : 0.5;
  return s;
}

// 映画/TVのみ＆アダルト除外
function isWantedResult(r) {
  return (r.media_type === 'movie' || r.media_type === 'tv') && !r.adult && !r.softcore;
}

async function tmdbSearchMulti(query) {
  const res = await fetch('/api/tmdb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'search_multi', query }),
  });
  const json = await res.json();
  return json.results || [];
}

// 入力タイトルをTMDBでそのまま検索（速い）。関連度順に最大12件。
export async function searchTitlesTMDB(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const raw = await tmdbSearchMulti(q);
  const ql = q.toLowerCase();
  return raw
    .filter(isWantedResult)
    .map((r) => ({ r, score: scoreTmdbResult(r, ql) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ r }) => mapTmdbResult(r));
}

// 検索語をAIで解釈→正規の英語タイトル候補を得て、各タイトルをTMDBで実在確認（賢い）。
// 曖昧・日本語・うろ覚え・タイポ入力を救う。
export async function aiSearchTitles(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const titles = await aiResolveTitles(q);
  if (!titles.length) return [];
  const hits = await Promise.all(
    titles.map(async (t) => {
      try {
        const raw = await tmdbSearchMulti(t);
        const tl = t.toLowerCase();
        const cands = raw.filter(isWantedResult);
        if (!cands.length) return null;
        cands.sort((a, b) => scoreTmdbResult(b, tl) - scoreTmdbResult(a, tl));
        return mapTmdbResult(cands[0]);
      } catch {
        return null;
      }
    })
  );
  const seen = new Set();
  return hits.filter((it) => it && !seen.has(it.tmdbId) && seen.add(it.tmdbId));
}

// 候補 → openDrama に渡す drama オブジェクトへ変換
export function candidateToDrama(s, userLevel) {
  const mt = s.mediaType === 'movie' ? 'movie' : 'tv';
  return {
    title: s.title,
    englishTitle: s.englishTitle,
    tmdbId: s.tmdbId,
    posterPath: s.posterPath ? s.posterPath.replace('/w185', '/w780') : null,
    type: mt,
    mediaType: mt,
    level: userLevel || 'B1',
    platform: '',
    genre: '',
    reason: '',
  };
}
