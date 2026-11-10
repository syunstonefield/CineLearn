'use client';

// 作品の配信先（拡張が対応する3サービス）を TMDB から取り、端末に7日覚える（2026-11-10）。
//   単語リスト画面に入った時に取っておく＝「入場する」を押した瞬間に開ける（押してから問い合わせると、
//   待つ間にポップアップとして止められて開かない）。覚え書きは端末だけ（同期しない・作品の配信は人によらない）。
import { tmdb } from './api';
import { extServicesFromProviders } from './serviceEntry';

const KEY = 'cl_avail_cache_v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

const keyOf = (tmdbId, isMovie) => `${isMovie ? 'm' : 't'}${tmdbId}`;

function loadAll() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

// 覚えている配信先（7日以内）。無ければ null。
export function loadAvailability(tmdbId, isMovie) {
  if (!tmdbId) return null;
  const e = loadAll()[keyOf(tmdbId, isMovie)];
  if (!e || !Array.isArray(e.names) || !(Date.now() - e.at < TTL_MS)) return null;
  return { ok: true, names: e.names };
}

function save(tmdbId, isMovie, names) {
  try {
    const all = loadAll();
    all[keyOf(tmdbId, isMovie)] = { names, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete all[k]);
    }
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 覚えられないだけ */
  }
}

// 取得（覚えていればそれ）。失敗は { ok:false }（＝「配信：」を出さない・入場で自動で開かない）。
export async function fetchAvailability(tmdbId, isMovie) {
  if (!tmdbId) return { ok: false, names: [] };
  const cached = loadAvailability(tmdbId, isMovie);
  if (cached) return cached;
  try {
    const data = await tmdb(isMovie ? { action: 'movie_watch_providers', movieId: tmdbId } : { action: 'watch_providers', tvId: tmdbId });
    if (!data || data.error || !data.results) return { ok: false, names: [] };
    const names = extServicesFromProviders(data);
    save(tmdbId, isMovie, names);
    return { ok: true, names };
  } catch {
    return { ok: false, names: [] };
  }
}
