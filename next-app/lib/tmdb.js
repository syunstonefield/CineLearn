// TMDb 経由のタイトル情報取得。js/app.js から移植。
import { tmdb } from './api';

// TV のシーズン情報を取得
export async function fetchSeasonInfoFromTMDb(title) {
  try {
    const searchData = await tmdb({ action: 'search', query: title });
    const show = searchData.results?.[0];
    if (!show) return null;

    const detail = await tmdb({ action: 'seasons', tvId: show.id });
    if (!detail.seasons) return null;

    const seasons = detail.seasons
      .filter((s) => s.season_number > 0 && s.episode_count > 0)
      .map((s) => ({ season: s.season_number, episodes: s.episode_count }));

    const englishTitle = detail.name || show.original_name || title;
    const imgPath = show.backdrop_path || show.poster_path;
    const posterPath = imgPath ? `https://image.tmdb.org/t/p/w780${imgPath}` : null;
    return seasons.length ? { seasons, englishTitle, tmdbId: show.id, posterPath } : null;
  } catch {
    return null;
  }
}

// 映画を検索して英語タイトル等を取得
export async function fetchMovieInfoFromTMDb(title) {
  try {
    const data = await tmdb({ action: 'search_movie', query: title });
    const movie = data.results?.[0];
    if (!movie) return null;
    const englishTitle = movie.title || movie.original_title || title;
    const imgPath = movie.backdrop_path || movie.poster_path;
    const posterPath = imgPath ? `https://image.tmdb.org/t/p/w780${imgPath}` : null;
    return { englishTitle, tmdbId: movie.id, posterPath };
  } catch {
    return null;
  }
}

// /search/multi で TVと映画の最上位候補をそれぞれ取得
export async function fetchTitleCandidatesFromTMDb(title) {
  const posterOf = (x) => {
    const p = x.backdrop_path || x.poster_path;
    return p ? `https://image.tmdb.org/t/p/w780${p}` : null;
  };
  const yearOf = (x) => (x.first_air_date || x.release_date || '').slice(0, 4);
  try {
    const data = await tmdb({ action: 'search_multi', query: title });
    const results = (data.results || []).filter(
      (x) => x.media_type === 'movie' || x.media_type === 'tv'
    );
    const shape = (x) =>
      x && {
        type: x.media_type,
        tmdbId: x.id,
        englishTitle: x.title || x.name || x.original_title || x.original_name || title,
        year: yearOf(x),
        posterPath: posterOf(x),
      };
    return {
      tv: shape(results.find((x) => x.media_type === 'tv')),
      movie: shape(results.find((x) => x.media_type === 'movie')),
    };
  } catch {
    return { tv: null, movie: null };
  }
}

// 候補からメタ情報を解決する（TVはシーズン詳細を追加取得）
export async function resolveTitleCandidate(cand, title) {
  if (!cand) return null;
  if (cand.type === 'movie') return cand;
  try {
    const detail = await tmdb({ action: 'seasons', tvId: cand.tmdbId });
    const seasons = (detail.seasons || [])
      .filter((s) => s.season_number > 0 && s.episode_count > 0)
      .map((s) => ({ season: s.season_number, episodes: s.episode_count }));
    return {
      ...cand,
      englishTitle: detail.name || cand.englishTitle || title,
      seasons: seasons.length ? seasons : [{ season: 1, episodes: 10 }],
    };
  } catch {
    return null;
  }
}

// タイトルが TV か映画かを判定しつつメタ情報を返す。
// mediaTypeHint があればそれを優先。両タイプ存在かつ hint なしのときは
// onAskMediaType(tv, movie) を呼んでユーザーに選ばせる（Promiseを返すこと）。
export async function fetchTitleInfoFromTMDb(title, mediaTypeHint = null, onAskMediaType = null) {
  const { tv, movie } = await fetchTitleCandidatesFromTMDb(title);

  let pick = null;
  if (mediaTypeHint === 'tv') pick = tv || movie;
  else if (mediaTypeHint === 'movie') pick = movie || tv;
  else if (tv && movie && onAskMediaType) pick = await onAskMediaType(tv, movie);
  else pick = tv || movie;

  const resolved = await resolveTitleCandidate(pick, title);
  if (resolved) return resolved;

  // フォールバック：従来の TV → 映画 個別検索
  const tvFb = await fetchSeasonInfoFromTMDb(title);
  if (tvFb) return { type: 'tv', ...tvFb };
  const mvFb = await fetchMovieInfoFromTMDb(title);
  if (mvFb) return { type: 'movie', ...mvFb };
  return null;
}

// あらすじ＋エピソードスチル画像をTMDBから取得（日本語優先はサーバー側で処理）。
// 戻り値: { overview, still } | null。still はエピソードの場面写真（横長）の
// フルURL。バックエンドが still_path 未対応（旧デプロイ）の間は null になり、
// 呼び出し側が作品ポスターへフォールバックする。
const _synopsisCache = {}; // tmdbId+S/E → 結果（再取得を防ぐ）
export async function fetchEpisodeSynopsis(drama, season, episode) {
  if (!drama?.tmdbId) return null;
  const isMovie = drama.type === 'movie';
  const key = `${drama.tmdbId}_${isMovie ? 'movie' : 's' + season + 'e' + episode}`;
  if (key in _synopsisCache) return _synopsisCache[key];
  try {
    const d = await tmdb(
      isMovie
        ? { action: 'episode_overview', movieId: drama.tmdbId }
        : { action: 'episode_overview', tvId: drama.tmdbId, season, episode }
    );
    _synopsisCache[key] =
      d && (d.overview || d.still_path)
        ? {
            overview: d.overview || '',
            still: d.still_path ? `https://image.tmdb.org/t/p/w500${d.still_path}` : null,
          }
        : null;
  } catch {
    _synopsisCache[key] = null;
  }
  return _synopsisCache[key];
}

// TMDb の provider_id → CineLearnサービス名（JP向け）
export const PROVIDER_MAP = {
  8: 'Netflix',
  1796: 'Netflix',
  10: 'Amazon Prime',
  9: 'Amazon Prime',
  337: 'Disney+',
  350: 'Apple TV+',
  2: 'Apple TV+',
  15: 'Hulu',
  269: 'Hulu',
  97: 'U-NEXT',
  192: 'YouTube',
  3: 'YouTube',
};

export const ALL_SERVICES = [
  { name: 'Netflix', icon: '🔴' },
  { name: 'Amazon Prime', icon: '🔵' },
  { name: 'Disney+', icon: '🔷' },
  { name: 'Apple TV+', icon: '🍎' },
  { name: 'Hulu', icon: '🟢' },
  { name: 'U-NEXT', icon: '🟣' },
  { name: 'YouTube', icon: '▶️' },
];

// 視聴可能サービス名の集合を取得する（loadDramaFromLibrary 内の providers 部分）
export async function fetchAvailableServices(drama) {
  const availableNames = new Set();
  try {
    let tmdbId = drama.tmdbId;
    let isMovie = drama.type === 'movie';
    if (!tmdbId) {
      const searchData = await tmdb({ action: 'search', query: drama.title });
      let firstResult = searchData.results?.[0];
      if (!firstResult) {
        const mvData = await tmdb({ action: 'search_movie', query: drama.title });
        firstResult = mvData.results?.[0];
        if (firstResult) isMovie = true;
      }
      tmdbId = firstResult?.id;
      if (tmdbId) drama.tmdbId = tmdbId;
      if ((firstResult?.backdrop_path || firstResult?.poster_path) && !drama.posterPath) {
        const imgPath = firstResult.backdrop_path || firstResult.poster_path;
        drama.posterPath = `https://image.tmdb.org/t/p/w780${imgPath}`;
      }
    }
    if (tmdbId) {
      const data = await tmdb(
        isMovie
          ? { action: 'movie_watch_providers', movieId: tmdbId }
          : { action: 'watch_providers', tvId: tmdbId }
      );
      const jp = data.results?.JP;
      const providers = [
        ...(jp?.flatrate || []),
        ...(jp?.rent || []),
        ...(jp?.buy || []),
      ];
      providers.forEach((p) => {
        if (PROVIDER_MAP[p.provider_id]) availableNames.add(PROVIDER_MAP[p.provider_id]);
      });
    }
  } catch {
    /* 取得失敗時は全サービス表示 */
  }
  return availableNames;
}
