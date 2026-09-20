// OpenSubtitles の in-process クライアント（§1・A5・A21）。HTTP 自己呼び出し（lib/api の searchSubtitles/downloadSubtitle）はしない。
//   app/api/subtitles/route.js の search / download / getAuthToken を移植し、生成用の取得規則（旧 lib/subtitles.js
//   fetchEpisodeSubtitle）をサーバ側に置いた。
//   * osSearch: tmdbId 必須（title query フォールバックは廃止＝A6。TV は parent_tmdb_id＋話数、映画は tmdb_id）。
//   * osDownload: ログイン JWT のモジュールキャッシュ（23h）と 401 再ログイン1回は従来どおり。
//       DL 応答の remaining/requests/reset_time_utc を必ず console.log('[CL:OS] ...')（remaining<50 または匿名フォールバック時は warn）、
//       Upstash が設定されていれば SET os:dl:last <json> と os:dl:d:<UTC日> の INCR を await する（fire-and-forget 禁止）。
//       remaining===0 かつ link 無し／HTTP 406 → UpstreamError('os_quota')（字幕なしと区別する）。
//       生成用 DL は os:dl:d:<UTC日> が CL_OS_DL_DAILY_CAP（既定700）以上なら DL せず 'os_quota'（共有枠の保護）。
//   * fetchEpisodeSrt: subtitle_raw_cache → nosub 否定キャッシュ → OS 検索 → selectSubtitleCandidates → 上位1候補 DL、
//       musicRatio>5 または parseSrt(text).length<200 のときだけ次候補（最大3）→ raw cache 書込（await）→ GC（A21）。
//       OS 検索が空なら SET nosub:<rawKey> 1 EX 86400（probe/generate とも命中時は OS に問い合わせない）。
//   * probeEpisode: 字幕の有無 {found,count} だけ（raw cache 命中を先に返し、未命中時のみ OS 検索・probe:<rawKey> に 6h）。
//   ★ 生 SRT はこのモジュールの外（route の応答）へ絶対に出さない。ログにも本文を出さない（A20）。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { parseSrt, selectSubtitleCandidates } from '../subtitles.js';
import {
  OS_DL_DAILY_CAP,
  OS_DL_WARN_REMAINING,
  OS_CANDIDATES_MAX,
  OS_MUSIC_RATIO_MAX,
  MIN_SRT_CHARS,
  NOSUB_TTL_SEC,
  PROBE_TTL_SEC,
  UpstreamError,
} from './constants.js';
import { rawCacheKey, readRawCacheRow, hasRawCache, writeRawCache, gcRawCacheOpportunistic } from './subtitleRawCache.js';
import { upstashConfigured, redisGet, redisSet, redisPipeline, utcDayKey, tryRedis } from './upstash.js';

const OS_BASE = 'https://api.opensubtitles.com/api/v1';
const USER_AGENT = 'CineLearn v1.0';
const OS_DL_LAST_KEY = 'os:dl:last';
const OS_DL_DAY_TTL_SEC = 90000; // 25h（UTC 日替わり後も残す）

// 否定キャッシュ・probe キャッシュのキー（字幕の有無は vocab の版に依らないので raw key ベース）。
export const nosubKey = (rawKey) => `nosub:${rawKey}`;
export const probeKey = (rawKey) => `probe:${rawKey}`;
export const osDlDayKey = (now = Date.now()) => `os:dl:d:${utcDayKey(now)}`;

function positiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function apiKeyOrThrow(env) {
  const key = env.OPENSUBTITLES_API_KEY;
  if (!key) throw new UpstreamError('misconfigured');
  return key;
}

function baseHeaders(apiKey) {
  return { 'Api-Key': apiKey, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT };
}

// ── ログイン（ダウンロード枠 5/日 → VIP 枠）────────────────────────────
// OPENSUBTITLES_USERNAME / _PASSWORD があればログインし JWT を付与。約24h 有効＝23h でモジュール変数を更新。
// 未設定・失敗時は匿名（5/日）にフォールバック（osDownload が warn を出す）。
let cachedToken = null;
let tokenExpiry = 0;

async function getAuthToken(apiKey, { env = process.env, fetchImpl = fetch } = {}) {
  const username = env.OPENSUBTITLES_USERNAME;
  const password = env.OPENSUBTITLES_PASSWORD;
  if (!username || !password) return null;
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  try {
    const r = await fetchImpl(`${OS_BASE}/login`, {
      method: 'POST',
      headers: baseHeaders(apiKey),
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      cachedToken = null;
      return null;
    }
    const data = await r.json();
    if (data?.token) {
      cachedToken = data.token;
      tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
      return cachedToken;
    }
  } catch {
    /* ログイン失敗は匿名フォールバック */
  }
  return null;
}

// ── 検索 ──────────────────────────────────────────────────────────────
// { tmdbId, type:'movie'|'tv', season, episode } → OS の data 配列（生の subtitle オブジェクト）。
// 非2xx・通信失敗は UpstreamError('os_search', {status})。tmdbId 無しは TypeError（route が先に検証する）。
export async function osSearch({ tmdbId, type = 'tv', season, episode }, { env = process.env, fetchImpl = fetch, log = console } = {}) {
  const id = positiveInt(tmdbId);
  if (!id) throw new TypeError('osSearch: tmdbId は正の整数（title query は廃止）');
  const apiKey = apiKeyOrThrow(env);
  const params = new URLSearchParams({ languages: 'en' });
  if (type === 'movie') {
    params.set('type', 'movie');
    params.set('tmdb_id', String(id));
  } else {
    // TV は parent_tmdb_id ＋話数で厳密検索（タイトル文字列クエリだと邦題が英語字幕DBに一致しない・2026-07-03実測）
    params.set('parent_tmdb_id', String(id));
    params.set('season_number', String(positiveInt(season) || 1));
    params.set('episode_number', String(positiveInt(episode) || 1));
  }
  let r;
  try {
    r = await fetchImpl(`${OS_BASE}/subtitles?${params}`, { headers: baseHeaders(apiKey), cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new UpstreamError('os_search', { cause: err });
  }
  if (!r.ok) throw new UpstreamError('os_search', { status: r.status });
  let data;
  try {
    data = await r.json();
  } catch (err) {
    throw new UpstreamError('os_search', { status: r.status, cause: err });
  }
  const list = Array.isArray(data?.data) ? data.data : [];
  log.info?.(`[CL:OS] search tmdb${id} ${type === 'movie' ? 'movie' : `s${season}e${episode}`} → ${list.length}件`);
  return list;
}

// ── ダウンロード ───────────────────────────────────────────────────────
// osDownload(fileId, { enforceDailyCap }) → { srt, status, remaining, requests, resetUtc, anonymous }
//   enforceDailyCap: 生成用（fetchEpisodeSrt）は true＝os:dl:d:<日> が CL_OS_DL_DAILY_CAP 以上なら DL せず 'os_quota'。
//                    seed の backfill/verify（/api/subtitles action:'download'）は false で呼べる（計数はする）。
//   投げる: UpstreamError 'os_quota'（406／remaining 0 で link 無し／日次キャップ）・'os_download'（それ以外の失敗）・'misconfigured'
export async function osDownload(fileId, { enforceDailyCap = true, env = process.env, fetchImpl = fetch, log = console, now = Date.now } = {}) {
  const fid = positiveInt(fileId);
  if (!fid) throw new TypeError('osDownload: fileId は正の整数');
  const apiKey = apiKeyOrThrow(env);
  const redisOpts = { env, fetchImpl };

  // 共有枠の日次キャップ（A5）。Upstash 未設定なら判定しない。
  if (enforceDailyCap && upstashConfigured(env)) {
    const used = Number(await tryRedis(() => redisGet(osDlDayKey(now()), redisOpts), null, { env, log }));
    if (Number.isFinite(used) && used >= OS_DL_DAILY_CAP) {
      log.warn?.(`[CL:OS] daily cap reached (${used}/${OS_DL_DAILY_CAP}) → os_quota`);
      throw new UpstreamError('os_quota', { status: 0 });
    }
  }

  const headers = baseHeaders(apiKey);
  const token = await getAuthToken(apiKey, { env, fetchImpl });
  const dl = (tok) =>
    fetchImpl(`${OS_BASE}/download`, {
      method: 'POST',
      headers: tok ? { ...headers, Authorization: `Bearer ${tok}` } : headers,
      body: JSON.stringify({ file_id: fid }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

  let r;
  try {
    r = await dl(token);
    // トークン失効（401）時は1回だけ再ログインしてリトライ
    if (r.status === 401 && token) {
      cachedToken = null;
      const fresh = await getAuthToken(apiKey, { env, fetchImpl });
      if (fresh) r = await dl(fresh);
    }
  } catch (err) {
    throw new UpstreamError('os_download', { cause: err });
  }
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  const remaining = Number.isFinite(Number(data?.remaining)) ? Number(data.remaining) : null;
  const requests = Number.isFinite(Number(data?.requests)) ? Number(data.requests) : null;
  const resetUtc = data?.reset_time_utc || null;
  const anonymous = !token;

  // 残枠ログ（監視の1箇所）。本文は出さない。
  const quotaLine = `[CL:OS] download file_id=${fid} status=${r.status} remaining=${remaining ?? '?'} requests=${requests ?? '?'} reset_time_utc=${resetUtc ?? '?'}${anonymous ? ' (anonymous)' : ''}`;
  if (anonymous || (remaining != null && remaining < OS_DL_WARN_REMAINING)) log.warn?.(quotaLine);
  else log.log?.(quotaLine);

  // Upstash に残枠と日次 DL 数を残す（await・失敗は握りつぶす）。
  if (upstashConfigured(env)) {
    const dayKey = osDlDayKey(now());
    await tryRedis(
      () =>
        redisPipeline(
          [
            ['SET', OS_DL_LAST_KEY, JSON.stringify({ remaining, requests, resetUtc, status: r.status, at: new Date(now()).toISOString() })],
            ['INCR', dayKey],
            ['EXPIRE', dayKey, String(OS_DL_DAY_TTL_SEC), 'NX'],
          ],
          redisOpts
        ),
      null,
      { env, log }
    );
  }

  if (!data?.link) {
    // 枠切れ（406 or remaining 0）は字幕なしと区別して返す（A5）
    if (r.status === 406 || remaining === 0) throw new UpstreamError('os_quota', { status: r.status });
    throw new UpstreamError('os_download', { status: r.status });
  }
  let srt;
  try {
    const srtRes = await fetchImpl(data.link, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!srtRes.ok) throw new UpstreamError('os_download', { status: srtRes.status });
    srt = await srtRes.text();
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('os_download', { cause: err });
  }
  return { srt, status: r.status, remaining, requests, resetUtc, anonymous };
}

// 歌詞字幕の判定（♪ が 100 字あたり OS_MUSIC_RATIO_MAX 超）。
export function musicRatioOf(text) {
  const s = String(text || '');
  if (!s.length) return 0;
  return (s.match(/♪/g) || []).length / (s.length / 100);
}

// ── 生成用の生 SRT 取得 ────────────────────────────────────────────────
// { tmdbId, type, season, episode } → { raw, fileId, via:'raw_cache'|'opensubtitles' } | null（字幕なし）
//   season/episode は正規化済み（映画 0/0）を渡す。投げる: UpstreamError（os_search/os_download/os_quota/misconfigured）。
export async function fetchEpisodeSrt({ tmdbId, type = 'tv', season = 0, episode = 0 }, deps = {}) {
  const { env = process.env, fetchImpl = fetch, log = console, now = Date.now } = deps;
  const id = positiveInt(tmdbId);
  if (!id) throw new TypeError('fetchEpisodeSrt: tmdbId は正の整数');
  const isMovie = type === 'movie';
  const s = isMovie ? 0 : Number(season) || 1;
  const e = isMovie ? 0 : Number(episode) || 1;
  const rawKey = rawCacheKey(id, s, e);
  const redisOpts = { env, fetchImpl };

  // 1) subtitle_raw_cache（未失効）
  const row = await readRawCacheRow(rawKey, { fetchImpl });
  if (row) {
    log.info?.(`[CL:OS] raw cache hit ${rawKey} chars=${row.raw.length}`);
    return { raw: row.raw, fileId: row.fileId, via: 'raw_cache' };
  }

  // 2) 否定キャッシュ（前回 OS 検索が空）
  if (await tryRedis(() => redisGet(nosubKey(rawKey), redisOpts), null, { env, log })) {
    log.info?.(`[CL:OS] nosub cache hit ${rawKey}`);
    return null;
  }

  // 3) OS 検索 → 候補選別
  const subs = await osSearch({ tmdbId: id, type: isMovie ? 'movie' : 'tv', season: s, episode: e }, { env, fetchImpl, log });
  const sorted = selectSubtitleCandidates(subs, isMovie, s, e);
  if (!sorted.length) {
    await tryRedis(() => redisSet(nosubKey(rawKey), '1', { ex: NOSUB_TTL_SEC }, redisOpts), null, { env, log });
    return null;
  }

  // 4) 上位1候補を DL。歌詞字幕／短すぎ のときだけ次候補へ（最大 OS_CANDIDATES_MAX）
  let raw = null;
  let fileId = null;
  let tried = 0;
  for (const cand of sorted.slice(0, OS_CANDIDATES_MAX)) {
    const fid = positiveInt(cand?.attributes?.files?.[0]?.file_id);
    if (!fid) continue;
    tried++;
    const { srt } = await osDownload(fid, { enforceDailyCap: true, env, fetchImpl, log, now });
    if (!srt) continue;
    const ratio = musicRatioOf(srt);
    if (ratio > OS_MUSIC_RATIO_MAX) {
      log.info?.(`[CL:OS] file_id=${fid} skipped: musicRatio ${ratio.toFixed(1)}`);
      continue;
    }
    const parsedLen = parseSrt(srt).length;
    if (parsedLen < MIN_SRT_CHARS) {
      log.info?.(`[CL:OS] file_id=${fid} skipped: parsed ${parsedLen} chars`);
      continue;
    }
    raw = srt;
    fileId = fid;
    break;
  }
  if (!raw) {
    // 全滅＝字幕なし扱い。DL 枠を毎回3つ消費しないよう否定キャッシュに入れる（内容による除外のみ＝通信失敗は throw 済み）
    log.warn?.(`[CL:OS] no usable subtitle for ${rawKey} (tried ${tried})`);
    await tryRedis(() => redisSet(nosubKey(rawKey), '1', { ex: NOSUB_TTL_SEC }, redisOpts), null, { env, log });
    return null;
  }

  // 5) raw cache 書込（await）→ 日次1回の失効行 GC
  await writeRawCache({ key: rawKey, tmdbId: id, season: s, episode: e, raw, fileId }, { fetchImpl, log });
  await gcRawCacheOpportunistic({ fetchImpl, log, env, now: now() });
  return { raw, fileId, via: 'opensubtitles' };
}

// ── 字幕の有無だけを返す（/api/subtitles action:'probe' 用・A5）─────────
// → { found: boolean, count: number, via: 'raw_cache'|'nosub_cache'|'probe_cache'|'opensubtitles' }
//   投げる: UpstreamError（os_search/misconfigured）。DL はしない。
export async function probeEpisode({ tmdbId, type = 'tv', season = 0, episode = 0 }, deps = {}) {
  const { env = process.env, fetchImpl = fetch, log = console } = deps;
  const id = positiveInt(tmdbId);
  if (!id) throw new TypeError('probeEpisode: tmdbId は正の整数');
  const isMovie = type === 'movie';
  const s = isMovie ? 0 : Number(season) || 1;
  const e = isMovie ? 0 : Number(episode) || 1;
  const rawKey = rawCacheKey(id, s, e);
  const redisOpts = { env, fetchImpl };

  if (await hasRawCache(rawKey, { fetchImpl })) return { found: true, count: 1, via: 'raw_cache' };
  if (await tryRedis(() => redisGet(nosubKey(rawKey), redisOpts), null, { env, log })) return { found: false, count: 0, via: 'nosub_cache' };
  const cachedProbe = await tryRedis(() => redisGet(probeKey(rawKey), redisOpts), null, { env, log });
  if (cachedProbe) {
    try {
      const p = JSON.parse(cachedProbe);
      if (typeof p?.found === 'boolean') return { found: p.found, count: Number(p.count) || 0, via: 'probe_cache' };
    } catch {
      /* 壊れた値は無視して問い合わせる */
    }
  }
  const subs = await osSearch({ tmdbId: id, type: isMovie ? 'movie' : 'tv', season: s, episode: e }, { env, fetchImpl, log });
  const count = selectSubtitleCandidates(subs, isMovie, s, e).length;
  const found = count > 0;
  await tryRedis(() => redisSet(probeKey(rawKey), JSON.stringify({ found, count }), { ex: PROBE_TTL_SEC }, redisOpts), null, { env, log });
  if (!found) await tryRedis(() => redisSet(nosubKey(rawKey), '1', { ex: NOSUB_TTL_SEC }, redisOpts), null, { env, log });
  return { found, count, via: 'opensubtitles' };
}

// /api/health 用: 直近 DL の残枠（Upstash の os:dl:last）。未設定・失敗は null。
export async function readOsQuotaLast({ env = process.env, fetchImpl = fetch, log = console } = {}) {
  const v = await tryRedis(() => redisGet(OS_DL_LAST_KEY, { env, fetchImpl }), null, { env, log });
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

// テスト用（ログイン JWT のキャッシュを跨がせない）
export function _resetOsTokenForTests() {
  cachedToken = null;
  tokenExpiry = 0;
}
