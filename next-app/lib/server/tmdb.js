// TMDB の in-process クライアント（A6）。TMDB_API_KEY 直・HTTP 自己呼び出し（lib/api の tmdb()）はしない。
//   * resolveByTmdbId: クライアント由来の title を信用せず、tmdbId から英題/邦題/ポスターを引く。
//     vocab-generate は Haiku プロンプトの作品名と vocab_cache.display_title にこの値を使う（body.title は使わない）。
//   * tmdbSearch: /api/example の resolveTmdbId（タイトル→ID）が使う検索の置換え（search_multi / search_movie / search）。
//   * 失敗は UpstreamError('tmdb', {status})（route は 502 {error:'upstream', reason:'tmdb'} に写す）。
//   * 解決結果はモジュール Map に 1 時間キャッシュ（同じ作品の連続生成で TMDB を叩き直さない・500件で最古削除）。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { UpstreamError } from './constants.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const RESOLVE_CACHE_TTL_MS = 60 * 60 * 1000;
const RESOLVE_CACHE_MAX = 500;
const resolveCache = new Map(); // `${type}:${id}` → { value, expiresAt }

function apiKeyOrThrow(env) {
  const key = env.TMDB_API_KEY;
  if (!key) throw new UpstreamError('misconfigured');
  return key;
}

// TMDB GET。path は自前の定数から組む（クライアント文字列をパスに埋めない＝ID は整数化して使う）。
export async function tmdbGet(path, params = {}, { fetchImpl = fetch, env = process.env } = {}) {
  const apiKey = apiKeyOrThrow(env);
  const qs = new URLSearchParams({ api_key: apiKey, ...params });
  let res;
  try {
    res = await fetchImpl(`${TMDB_BASE}${path}?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw new UpstreamError('tmdb', { cause: err });
  }
  if (!res.ok) throw new UpstreamError('tmdb', { status: res.status });
  try {
    return await res.json();
  } catch (err) {
    throw new UpstreamError('tmdb', { status: res.status, cause: err });
  }
}

function positiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// tmdbId → { tmdbId, type, englishTitle, displayTitle, originalTitle, posterPath }
//   englishTitle = en-US の title/name（OS 字幕は英語なので Haiku の作品名もこれ）
//   displayTitle = ja-JP の title/name（無ければ英題）
export async function resolveByTmdbId({ tmdbId, type }, { fetchImpl = fetch, env = process.env, now = Date.now } = {}) {
  const id = positiveInt(tmdbId);
  const kind = type === 'movie' ? 'movie' : 'tv';
  if (!id) throw new TypeError('resolveByTmdbId: tmdbId は正の整数');
  const ck = `${kind}:${id}`;
  const hit = resolveCache.get(ck);
  const t = now();
  if (hit && hit.expiresAt > t) return hit.value;

  const path = `/${kind}/${id}`;
  const [en, ja] = await Promise.all([
    tmdbGet(path, { language: 'en-US' }, { fetchImpl, env }),
    // 邦題は表示用＝取れなくても英題で代用する（en が取れていれば失敗扱いにしない）
    tmdbGet(path, { language: 'ja-JP' }, { fetchImpl, env }).catch(() => null),
  ]);
  const enTitle = String(en?.title || en?.name || '').trim();
  const jaTitle = String(ja?.title || ja?.name || '').trim();
  const original = String(en?.original_title || en?.original_name || '').trim();
  if (!enTitle && !original) throw new UpstreamError('tmdb', { status: 404 }); // ID はあるが作品名が無い＝解決不能
  const value = {
    tmdbId: id,
    type: kind,
    englishTitle: enTitle || original,
    displayTitle: jaTitle || enTitle || original,
    originalTitle: original || enTitle,
    posterPath: en?.poster_path || ja?.poster_path || null,
  };
  if (resolveCache.size >= RESOLVE_CACHE_MAX) resolveCache.delete(resolveCache.keys().next().value);
  resolveCache.set(ck, { value, expiresAt: t + RESOLVE_CACHE_TTL_MS });
  return value;
}

// タイトル検索（/api/example の resolveTmdbId 用）。action は /api/tmdb と同じ名前。結果の results 配列を返す。
//   search_multi … /search/multi（ja-JP・邦題でも当たる）
//   search_movie … /search/movie（en-US）
//   search       … /search/tv（ja-JP）
export async function tmdbSearch({ action, query }, opts) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return [];
  const spec =
    action === 'search_multi'
      ? { path: '/search/multi', language: 'ja-JP' }
      : action === 'search_movie'
        ? { path: '/search/movie', language: 'en-US' }
        : action === 'search'
          ? { path: '/search/tv', language: 'ja-JP' }
          : null;
  if (!spec) throw new TypeError(`tmdbSearch: unknown action ${action}`);
  const data = await tmdbGet(spec.path, { query: q, language: spec.language }, opts);
  return Array.isArray(data?.results) ? data.results : [];
}

// テスト用
export function _clearTmdbCacheForTests() {
  resolveCache.clear();
}
