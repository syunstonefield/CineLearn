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
    const imgPath = show.poster_path; // 縦のポスターだけ（横長の背景＝場面写真で代用しない・法務 2026-11-12）
    const posterPath = imgPath ? `https://image.tmdb.org/t/p/w342${imgPath}` : null;
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
    const imgPath = movie.poster_path; // 縦のポスターだけ（backdrop で代用しない・法務 2026-11-12）
    const posterPath = imgPath ? `https://image.tmdb.org/t/p/w342${imgPath}` : null;
    return { englishTitle, tmdbId: movie.id, posterPath };
  } catch {
    return null;
  }
}

// 題名の比べ方（大文字小文字・空白・記号の違いは同じとみなす）。x は TMDB の結果（映画/ドラマ）。
export function normTitleKey(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[：:／/・･｜|〜~‐‑–—\-!！?？.。,、'’"”“…]+/g, '');
}
export function sameTitle(x, title) {
  const k = normTitleKey(title);
  if (!k) return false;
  return [x?.title, x?.original_title, x?.name, x?.original_name].some((t) => t && normTitleKey(t) === k);
}

// /search/multi で TVと映画の最上位候補をそれぞれ取得
export async function fetchTitleCandidatesFromTMDb(title) {
  const posterOf = (x) => {
    const p = x.poster_path; // backdrop（場面写真）で代用しない・法務 2026-11-12
    return p ? `https://image.tmdb.org/t/p/w342${p}` : null;
  };
  const yearOf = (x) => (x.first_air_date || x.release_date || '').slice(0, 4);
  try {
    const data = await tmdb({ action: 'search_multi', query: title });
    const results = (data.results || []).filter(
      (x) => x.media_type === 'movie' || x.media_type === 'tv'
    );
    // englishTitle は「ラテン文字の原題」を最優先で採用する。検索は日本語設定のため
    // x.title / x.name は邦題＝従来は映画の englishTitle が邦題のままになり、
    // OSフォールバック検索の質とタイトル照合の英語alias経路を損ねていた
    // （2026-08-06 スパイダーマン表記ゆれ問題の遠因）。TVは後段 resolveTitleCandidate の
    // 詳細取得で上書きされ得るが、初期値もここで正しくしておく。
    // 非ラテン原題（韓国語・中国語等）は従来どおり邦題フォールバック（OS検索は基本
    // tmdbId 厳密検索のため実害は小さい）。
    const latinTitle = (s) =>
      s && /^[\x20-\x7EÀ-ɏ‘’“”–—…]+$/.test(s) ? s : null;
    const shape = (x) =>
      x && {
        type: x.media_type,
        tmdbId: x.id,
        englishTitle:
          latinTitle(x.original_title || x.original_name) ||
          x.title || x.name || x.original_title || x.original_name || title,
        year: yearOf(x),
        posterPath: posterOf(x),
      };
    // 題名が完全に一致する作品を優先し、無ければ1番目（2026-11-12: 「X-Men」の映画の1番目は X-MEN：アポカリプス）。
    const pick = (mt) => {
      const list = results.filter((x) => x.media_type === mt);
      return list.find((x) => sameTitle(x, title)) || list[0];
    };
    return {
      tv: shape(pick('tv')),
      movie: shape(pick('movie')),
    };
  } catch {
    return { tv: null, movie: null };
  }
}

// 検索・厳選から開いた作品は TMDB の ID と映画/ドラマが分かっている → 題名で検索し直さずにその ID を使う候補を返す。
//   2026-11-12: 単語リストの画面が邦題「X-MEN」で検索し直し、映画の1番目（X-MEN：アポカリプス）で ID を上書きしていた
//   （選んだのは X-Men 2000）。ID の無い古い一覧（mediaType 未設定を含む）は null＝従来どおり題名で探す。
//   type は使わない（古い記録は映画でも type:'tv' が入っていることがある）。mediaType だけを信じる。
export function knownTitleCandidate(drama) {
  const id = Number(drama?.tmdbId);
  const mt = drama?.mediaType;
  if (!Number.isInteger(id) || id <= 0 || (mt !== 'movie' && mt !== 'tv')) return null;
  return {
    type: mt,
    tmdbId: id,
    englishTitle: drama.englishTitle || drama.title || '',
    year: '',
    posterPath: drama.posterPath || null,
  };
}

// 保存された ID が、その作品の題名で検索した結果に入っているかを確かめる（2026-11-12）。
//   ホームのポスター取り直しが、映画の ID をドラマの検索結果の ID で上書きしていた（X-Men 映画 36657 → ドラマ 4574）。
//   入っていなければ null＝呼び出し側は題名で探し直す（完全一致を優先）。通信に失敗した時は候補をそのまま返す。
export async function verifyKnownCandidate(cand, title) {
  if (!cand) return null;
  const q = cand.englishTitle || title;
  if (!q) return cand;
  try {
    const data = await tmdb(cand.type === 'movie' ? { action: 'search_movie', query: q } : { action: 'search', query: q });
    const results = Array.isArray(data?.results) ? data.results : null;
    if (!results) return cand;
    return results.some((r) => r.id === cand.tmdbId) ? cand : null;
  } catch {
    return cand;
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
// 見放題（定額）の ID だけを載せる。レンタル/購入ストア（10=Amazon Video, 2=Apple TV Store,
// 3=Google Play Movies）は「サブスクで観られる」の誤判定になるので載せない（2026-10-08・実データで確認：
// GoT は U-NEXT 独占なのに 10 のレンタルで Amazon Prime が「配信中」になっていた）。
// 「… Amazon Channel」（有料チャンネル）も Prime 会員だけでは観られないので載せない。
export const PROVIDER_MAP = {
  8: 'Netflix',
  1796: 'Netflix', // Netflix Standard with Ads
  9: 'Amazon Prime', // Amazon Prime Video（JP では free 枠に入ることがある）
  2100: 'Amazon Prime', // Amazon Prime Video with Ads
  337: 'Disney+',
  350: 'Apple TV+',
  15: 'Hulu',
  84: 'U-NEXT',
  192: 'YouTube',
};

// OS依存の絵文字をやめ、ブランド色＋頭文字の中立レターマークで統一する。
// （実ロゴは「非提携」方針に反する恐れがあるため使わない / mark は単なる頭文字）
// 拡張の動作実態に合わせ Apple TV+/Hulu/U-NEXT は一旦UIから外す（2026-06-25・厳選）。
// PROVIDER_MAP には残してあるので、再対応時はここに行を戻すだけでよい。
// 視聴サービス選択の候補（拡張が対応するサービスのみ）。
// YouTube は例文が付かず今は未対応のため除外（LP/オンボ/設定の「近日対応予定」方針と統一・2026-07-04）。
export const ALL_SERVICES = [
  { name: 'Netflix', mark: 'N', color: '#E50914' },
  { name: 'Amazon Prime', mark: 'P', color: '#00A8E0' },
  { name: 'Disney+', mark: 'D', color: '#1A4BC4' },
];

// 視聴可能サービス名の集合を取得する（loadDramaFromLibrary 内の providers 部分）
export async function fetchAvailableServices(drama) {
  const availableNames = new Set();
  try {
    let tmdbId = drama.tmdbId;
    let isMovie = drama.type === 'movie' || drama.mediaType === 'movie';
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
      if (firstResult?.poster_path && !drama.posterPath) {
        const imgPath = firstResult.poster_path; // backdrop（場面写真）で代用しない・法務 2026-11-12
        drama.posterPath = `https://image.tmdb.org/t/p/w342${imgPath}`;
      }
    }
    if (tmdbId) {
      const data = await tmdb(
        isMovie
          ? { action: 'movie_watch_providers', movieId: tmdbId }
          : { action: 'watch_providers', tvId: tmdbId }
      );
      const jp = data.results?.JP;
      // 見放題の枠だけを見る（rent/buy は単品課金なので「視聴可能なサブスク」に数えない）。
      const providers = [
        ...(jp?.flatrate || []),
        ...(jp?.ads || []),
        ...(jp?.free || []),
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
