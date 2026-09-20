// subtitle_raw_cache（生 SRT・30条の4 の内部解析キャッシュ・非配信・TTL30日）の読み書き（§1・A21）。
//   app/api/example/route.js の readRawCache / writeRawCache をここへ移設。
//   * service_role 必須（anon には GRANT が無い＝外部から読めない）。未設定なら read は null・write は false。
//   * キーは 'tmdb{id}:s{S}e{E}'（映画は s0e0・vocab の版は付けない＝版が上がっても字幕は同じ）。
//   * write は await する（旧 route は fire-and-forget だったが Vercel は応答後に凍結する）。
//   * provider は 'opensubtitles:<file_id>'（どのファイルから来たかを残す＝seed の verify が同じ物を引ける）。
//   * GC は cron ではなく opportunistic: 書込後に gc:rawcache:<UTC日> を NX で取れた1回だけ失効行を DELETE（A21）。
// ★raw 本文をログに出さない（A20）。文字数・件数・status のみ。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { SUPABASE_URL, SUPABASE_SERVICE_KEY, RAW_CACHE_TTL_DAYS } from './constants.js';
import { upstashConfigured, redisSet, utcDayKey } from './upstash.js';

export const RAW_CACHE_TTL_MS = RAW_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

// 'tmdb{id}:s{S}e{E}'。season/episode は呼び出し側で正規化済み（映画は 0/0）の数値を渡す。
export function rawCacheKey(tmdbId, season, episode) {
  return `tmdb${Number(tmdbId)}:s${Number(season) || 0}e${Number(episode) || 0}`;
}

// provider 'opensubtitles:<file_id>' から file_id を取り出す（旧行は 'opensubtitles' のみ＝null）。
export function fileIdOfProvider(provider) {
  const m = /^opensubtitles:(\d+)$/.exec(String(provider || ''));
  return m ? Number(m[1]) : null;
}

function svcHeaders(extra = {}) {
  return { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, ...extra };
}

// 未失効の行を返す: { raw, fileId, provider, fetchedAt } | null。鍵未設定・不調・失効は null（呼び出し側は「無い」扱い）。
export async function readRawCacheRow(key, { fetchImpl = fetch } = {}) {
  if (!SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/subtitle_raw_cache?cache_key=eq.${encodeURIComponent(key)}&select=raw,provider,fetched_at,expires_at&limit=1`,
      { headers: svcHeaders(), cache: 'no-store' }
    );
    const rows = JSON.parse(await res.text());
    const row = Array.isArray(rows) && rows[0];
    if (!row || !row.raw) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null; // TTL 失効＝無い扱い
    return { raw: row.raw, fileId: fileIdOfProvider(row.provider), provider: row.provider || null, fetchedAt: row.fetched_at || null };
  } catch {
    return null;
  }
}

// 生 SRT 文字列だけを返す（旧 readRawCache と同形）。
export async function readRawCache(key, opts) {
  const row = await readRawCacheRow(key, opts);
  return row ? row.raw : null;
}

// 未失効の行が在るか（raw 本文を転送しない軽い問い合わせ＝probe 用）。
export async function hasRawCache(key, { fetchImpl = fetch } = {}) {
  if (!SUPABASE_SERVICE_KEY) return false;
  try {
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/subtitle_raw_cache?cache_key=eq.${encodeURIComponent(key)}&select=cache_key,expires_at&limit=1`,
      { headers: svcHeaders(), cache: 'no-store' }
    );
    const rows = JSON.parse(await res.text());
    const row = Array.isArray(rows) && rows[0];
    if (!row) return false;
    return !(row.expires_at && new Date(row.expires_at).getTime() < Date.now());
  } catch {
    return false;
  }
}

// upsert（既存は上書き）。戻り値: 書けたか。鍵未設定・非2xx・例外は false（呼び出し側の処理は止めない）。
export async function writeRawCache({ key, tmdbId, season, episode, raw, fileId }, { fetchImpl = fetch, log = console } = {}) {
  if (!SUPABASE_SERVICE_KEY) return false;
  if (!raw || typeof raw !== 'string') return false;
  const cacheKey = key || rawCacheKey(tmdbId, season, episode);
  const now = Date.now();
  try {
    const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/subtitle_raw_cache?on_conflict=cache_key`, {
      method: 'POST',
      headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      cache: 'no-store',
      body: JSON.stringify([
        {
          cache_key: cacheKey,
          tmdb_id: Number(tmdbId),
          season: Number(season) || 0,
          episode: Number(episode) || 0,
          raw,
          provider: fileId ? `opensubtitles:${fileId}` : 'opensubtitles',
          fetched_at: new Date(now).toISOString(),
          expires_at: new Date(now + RAW_CACHE_TTL_MS).toISOString(),
        },
      ]),
    });
    if (!res.ok) {
      log.warn?.('[CL:RAWCACHE] write failed', cacheKey, res.status);
      return false;
    }
    log.info?.(`[CL:RAWCACHE] wrote ${cacheKey} chars=${raw.length} file_id=${fileId ?? '-'}`);
    return true;
  } catch (err) {
    log.warn?.('[CL:RAWCACHE] write exception', cacheKey, String(err?.message || err));
    return false;
  }
}

// 失効行の物理削除を「1日1回だけ」試みる（A21）。Upstash 未設定なら何もしない。
//   gc:rawcache:<UTC日> を NX で取れたインスタンスだけが DELETE ...?expires_at=lt.<now> を await する。
//   戻り値: { ran: boolean, deleted: number|null }
export async function gcRawCacheOpportunistic({ fetchImpl = fetch, log = console, env = process.env, now = Date.now() } = {}) {
  if (!SUPABASE_SERVICE_KEY || !upstashConfigured(env)) return { ran: false, deleted: null };
  let got = null;
  try {
    got = await redisSet(`gc:rawcache:${utcDayKey(now)}`, '1', { nx: true, ex: 90000 }, { env, fetchImpl });
  } catch (err) {
    log.warn?.('[CL:RAWCACHE] gc flag failed', String(err?.message || err));
    return { ran: false, deleted: null };
  }
  if (got !== 'OK') return { ran: false, deleted: null }; // 今日は誰かが済ませた
  try {
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/subtitle_raw_cache?expires_at=lt.${encodeURIComponent(new Date(now).toISOString())}`,
      { method: 'DELETE', headers: svcHeaders({ Prefer: 'return=minimal,count=exact' }), cache: 'no-store' }
    );
    // count=exact のとき Content-Range: */N で削除件数が返る（返らなければ null）
    const range = res.headers?.get?.('content-range') || '';
    const n = Number(range.split('/')[1]);
    const deleted = Number.isFinite(n) ? n : null;
    if (!res.ok) log.warn?.('[CL:RAWCACHE] gc delete failed', res.status);
    else log.info?.(`[CL:RAWCACHE] gc deleted=${deleted ?? '?'}`);
    return { ran: true, deleted: res.ok ? deleted : null };
  } catch (err) {
    log.warn?.('[CL:RAWCACHE] gc exception', String(err?.message || err));
    return { ran: true, deleted: null };
  }
}
