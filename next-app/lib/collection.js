// 半券コレクション（作品単位の学習記録）のためのデータ補助。
// 作品の総話数・シーズン構成は TMDB から取得して端末ローカルにキャッシュする（tmdbId 単位）。
import { tmdb } from './api';

const epsCacheKey = (id) => `cl_total_eps_${id}`;
// TMDB の取得結果を端末に置いておく期間（TMDB の規約＝6か月を超えて持たない・法務 2026-11-12）。
//   取得日（at）を入れて保存し、90日より古いもの・取得日の無い旧キャッシュは取り直す。
export const EPS_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export function isFreshEpsCache(obj, now = Date.now()) {
  return !!obj && Number.isFinite(obj.at) && now - obj.at < EPS_CACHE_TTL_MS;
}

// キャッシュ済みの総話数情報 { total, seasons:[{season,episodes}] } を返す（無ければ null）。
export function getCachedSeasons(tmdbId) {
  if (!tmdbId) return null;
  try {
    const v = localStorage.getItem(epsCacheKey(tmdbId));
    if (!v) return null;
    const obj = JSON.parse(v);
    // 旧キャッシュ（制作年 firstYear / posterPath が無い）は未取得扱いにして再取得＝自己治癒。
    // posterPath は「キーの有無」で判定（null でも取得済み扱い＝再取得ループを防ぐ）。
    // names（照合用の作品名）が無い旧キャッシュも再取得＝自己治癒（偽ID検出に必要）。
    if (!obj || !('firstYear' in obj) || !('posterPath' in obj) || !('names' in obj)) return null;
    // 取得日の無い旧キャッシュ・90日より古いキャッシュも取り直す（backdrop で代用していた頃の posterPath もこれで消える）。
    if (!isFreshEpsCache(obj)) return null;
    return obj;
  } catch {
    return null;
  }
}

// TMDB からシーズン構成を取得して総話数を合算（キャッシュ優先）。movie は { total:1, seasons:[] }。
export async function fetchSeasons(tmdbId, isMovie = false) {
  if (isMovie) return { total: 1, seasons: [] };
  if (!tmdbId) return null;
  const cached = getCachedSeasons(tmdbId);
  if (cached) return cached;
  try {
    const detail = await tmdb({ action: 'seasons', tvId: tmdbId });
    const seasons = (detail.seasons || [])
      .filter((s) => s.season_number > 0 && s.episode_count > 0)
      .map((s) => ({ season: s.season_number, episodes: s.episode_count }));
    const total = seasons.reduce((a, s) => a + s.episodes, 0);
    const firstYear = (detail.first_air_date || '').slice(0, 4) || null;
    const lastYear = (detail.last_air_date || '').slice(0, 4) || null;
    // ポスター（半券の左暗部用）も一緒にキャッシュ＝この seasons 取得は進捗バーで必ず走るので、
    // ポスターを「ついで」に得てキャッシュすれば、別途の TMDB 検索往復を省ける（出るまでの遅延を削減）。
    // 縦スロット用に poster_path(縦) を優先・w342（ホームと同サイズ＝軽く速い）。
    const imgPath = detail.poster_path; // 縦のポスターだけ。無ければ文字カード（backdrop＝場面写真で代用しない・法務 2026-11-12）
    const posterPath = imgPath ? `https://image.tmdb.org/t/p/w342${imgPath}` : null;
    // 作品名を保持＝呼び出し側が「チケットのタイトルとIDの中身が一致するか」を照合できる
    // （同期事故で紛れ込んだ偽 tmdbId の検出用・2026-07-03）。
    const names = [detail.name, detail.original_name, detail.title, detail.original_title].filter(Boolean);
    const out = { total, seasons, firstYear, lastYear, posterPath, names, at: Date.now() };
    if (total > 0) {
      try {
        localStorage.setItem(epsCacheKey(tmdbId), JSON.stringify(out));
      } catch {
        /* ignore */
      }
    }
    return out;
  } catch {
    return null;
  }
}

// 「S1·E1 〜 S{last}·E{lastEps}」のような全話レンジ表記（seasons があれば全体・無ければ studied から）。
export function fullRangeLabel(seasons, studiedEpisodes) {
  if (Array.isArray(seasons) && seasons.length) {
    const sorted = [...seasons].sort((a, b) => a.season - b.season);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return `S${first.season}·E1 〜 S${last.season}·E${last.episodes}`;
  }
  // フォールバック: 学習済みエピソードの範囲
  const eps = (studiedEpisodes || []).filter((e) => e && e.season != null && e.episode != null);
  if (!eps.length) return '';
  const key = (e) => e.season * 1000 + e.episode;
  const sorted = [...eps].sort((a, b) => key(a) - key(b));
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  return a === b ? `S${a.season}·E${a.episode}` : `S${a.season}·E${a.episode} 〜 S${b.season}·E${b.episode}`;
}

// ── 作品の ID に結び付いたポスター（2026-11-12 X-Men の件）──────────────────
// 作品の記録（myDramas）の posterPath は URL を文字のまま持つだけで、どの ID の画像かを持たない。
// 作品の ID が直っても古い画像が残る（11/11 の取り違えで X-Men にアポカリプスの画像が残った）ので、
// ID がある作品は、その ID の画像を TMDB から取り、保存された URL より優先する。
//   ドラマ：fetchSeasons（ID で引く・ここにポスターも入る）。映画：題名で検索し、同じ ID の結果の poster_path。
//   縦のポスターだけ（backdrop で代用しない）・w342（法務）。取得日を入れて端末に置き、90日で取り直す。

// 表示に使うポスターの順番（純関数）。ID の画像 → 一覧で取り直した URL → 保存された URL → シーズン情報のキャッシュ。
export function pickPosterUrl({ idPoster, override, stored, seasonsPoster } = {}) {
  return idPoster || override || stored || seasonsPoster || null;
}

// 検索結果から、同じ ID の作品の縦のポスター（w342）を返す（無ければ ''）。
export function posterForIdFromResults(results, tmdbId) {
  const hit = (results || []).find((r) => r && r.id === tmdbId);
  return hit?.poster_path ? `https://image.tmdb.org/t/p/w342${hit.poster_path}` : '';
}

const moviePosterKey = (id) => `cl_movie_poster_${id}`;

export function getCachedMoviePoster(tmdbId) {
  if (!tmdbId) return null;
  try {
    const o = JSON.parse(localStorage.getItem(moviePosterKey(tmdbId)) || 'null');
    return o && typeof o.posterPath === 'string' && isFreshEpsCache(o) ? o.posterPath : null;
  } catch {
    return null;
  }
}

// 映画の ID のポスター。queries（作品名・英語名）で順に検索し、同じ ID が見つかった時だけ採る。
// 見つからない時は ''（＝ID の画像は無し・ほかの候補に回す）。通信の失敗は null（覚えない）。
export async function fetchMoviePosterById(tmdbId, queries) {
  if (!tmdbId) return '';
  const cached = getCachedMoviePoster(tmdbId);
  if (cached !== null) return cached;
  let url = '';
  try {
    for (const q of [...new Set((queries || []).filter(Boolean))]) {
      const data = await tmdb({ action: 'search_movie', query: q });
      url = posterForIdFromResults(data?.results, tmdbId);
      if (url) break;
    }
  } catch {
    return null;
  }
  try {
    localStorage.setItem(moviePosterKey(tmdbId), JSON.stringify({ posterPath: url, at: Date.now() }));
  } catch {
    /* 覚えられないだけ */
  }
  return url;
}
