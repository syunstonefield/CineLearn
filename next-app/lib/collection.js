// 半券コレクション（作品単位の学習記録）のためのデータ補助。
// 作品の総話数・シーズン構成は TMDB から取得して端末ローカルにキャッシュする（tmdbId 単位）。
import { tmdb } from './api';

const epsCacheKey = (id) => `cl_total_eps_${id}`;

// キャッシュ済みの総話数情報 { total, seasons:[{season,episodes}] } を返す（無ければ null）。
export function getCachedSeasons(tmdbId) {
  if (!tmdbId) return null;
  try {
    const v = localStorage.getItem(epsCacheKey(tmdbId));
    if (!v) return null;
    const obj = JSON.parse(v);
    // 旧キャッシュ（制作年 firstYear / posterPath が無い）は未取得扱いにして再取得＝自己治癒。
    // posterPath は「キーの有無」で判定（null でも取得済み扱い＝再取得ループを防ぐ）。
    if (!obj || !('firstYear' in obj) || !('posterPath' in obj)) return null;
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
    // ポスター（半券の左暗部用）も一緒にキャッシュ＝myDramas/クラウド同期に依存せず
    // tmdbId 単位で永続化し、リロードで消える問題を解消（既存 posterPath が無い時のフォールバック）。
    const imgPath = detail.backdrop_path || detail.poster_path;
    const posterPath = imgPath ? `https://image.tmdb.org/t/p/w780${imgPath}` : null;
    const out = { total, seasons, firstYear, lastYear, posterPath };
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
