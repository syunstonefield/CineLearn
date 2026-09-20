// seed 専用の本番 API ラッパ（2026-09-12・design-B §5 / A14）。
//
// 背景: 公開拡大前ブロッカー B で next-app/lib/api.js から searchSubtitles / downloadSubtitle / callClaude が
//   消え、/api/subtitles の download（と seed 向け search）は「x-cinelearn-seed ヘッダ一致」のときだけ
//   通る（isSeedRequest）。seed の各スクリプトはここを経由して本番 API を叩く。
//
// 方針:
//   * 秘密ヘッダは base のホストが cinelearn-next.vercel.app のときだけ付ける。旧 cine-learn は 307 転送殻
//     なので、ヘッダ付きで叩くと転送先へ流れる恐れがある（付けない＝匿名扱いで 403/429 になるだけ）。
//   * redirect は追わない（'manual'）。3xx が返ったら「base が転送されている」設定ミスとして止める。
//   * 生 SRT は subtitle_raw_cache（service_role）を先に読む。生成に使った SRT と同じ物が取れる
//     （別候補を DL し直すと tsSec が example とずれる）うえ、OpenSubtitles の DL 枠を消費しない。
//   * ログに生 SRT・整形本文は出さない（A20）。文字数・件数・status だけ。

import { selectSubtitleCandidates, parseSrt } from '../../next-app/lib/subtitles.js';

export const SEED_HOST = 'cinelearn-next.vercel.app'; // 秘密ヘッダを付けてよい唯一のホスト
export const API_BASE = process.env.CINELEARN_API_BASE || '';
export const API_ORIGIN = process.env.CINELEARN_API_ORIGIN || '';
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
// subtitle_raw_cache の TTL。サーバ側は lib/server/constants.js の定数（30日）＝ここも同値に保つ。
export const RAW_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// API 呼び出しの失敗（status と診断コードを持つ）。呼び出し側は code で分岐できる。
export class SeedApiError extends Error {
  constructor(message, { status = 0, code = 'api', data = null } = {}) {
    super(message);
    this.name = 'SeedApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

// 「次の話へ進んでも同じ失敗を繰り返すだけ」の code。各スクリプトの main はこれを見て走査を止める
// （設定ミス・秘密ヘッダ不一致・OS 日次枠切れを、話数ぶん連打してログを埋めない）。
export const FATAL_CODES = new Set([
  'config', // env 未設定
  'redirect', // base が 3xx 転送＝ホスト設定ミス
  'forbidden', // Origin ゲート／秘密ヘッダ不一致
  'rate_limited', // seed は免除のはず＝秘密ヘッダが効いていない
  'os_quota', // OpenSubtitles の DL 枠が上限（本日は無理）
  'search_unsupported', // 本番が seed 向け search を廃止している
  'not_deployed', // 本番にルートが無い
]);
export const isFatal = (err) => err instanceof SeedApiError && FATAL_CODES.has(err.code);

function baseHostname() {
  try {
    return new URL(API_BASE).hostname;
  } catch {
    return '';
  }
}

// 秘密ヘッダを付ける条件: env にあり、かつ base が cinelearn-next 本番であること。
export function seedSecretApplies() {
  return !!process.env.CL_SEED_SECRET && baseHostname() === SEED_HOST;
}

// 付けられない理由を1回だけ警告する（値は出さない）。
let warned = false;
export function warnIfSeedHeaderMissing() {
  if (warned || seedSecretApplies()) return;
  warned = true;
  if (!process.env.CL_SEED_SECRET) {
    console.warn('⚠ CL_SEED_SECRET 未設定 → x-cinelearn-seed を付けずに叩く（download は 403・生成は匿名枠の扱い）');
  } else {
    console.warn(`⚠ CINELEARN_API_BASE のホストが ${SEED_HOST} ではない → x-cinelearn-seed は付けない（別ホストへ秘密を流さない）`);
  }
}

// 本番 API 向けヘッダ。Origin/Referer は従来どおり CINELEARN_API_ORIGIN（Origin ゲート用）。
export function seedHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (API_ORIGIN) {
    h.Origin = API_ORIGIN;
    h.Referer = `${API_ORIGIN}/`;
  }
  if (seedSecretApplies()) h['x-cinelearn-seed'] = process.env.CL_SEED_SECRET;
  return h;
}

// JSON POST。戻り値 { status, data, text }。data は JSON として読めたときだけ（それ以外は null）。
// 3xx は追わずエラー（秘密ヘッダを別ホストへ持ち回らない）。
export async function seedPost(path, body, { timeoutMs = 60_000 } = {}) {
  if (!API_BASE) throw new SeedApiError('CINELEARN_API_BASE 未設定', { code: 'config' });
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: seedHeaders(),
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status >= 300 && res.status < 400) {
    throw new SeedApiError(
      `${path} が ${res.status} 転送を返した（CINELEARN_API_BASE を https://${SEED_HOST} に直す）`,
      { status: res.status, code: 'redirect' }
    );
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, text };
}

// ── OpenSubtitles（本番 /api/subtitles 経由）──────────────────────────────
// 検索。tmdbId 必須（TV は parent_tmdb_id＋話数、映画は tmdb_id）。OS 応答の data 配列を返す。
// サーバ側は seed 限定で 'search' を許す想定（S2）。廃止されていた場合は code:'search_unsupported'。
export async function seedSearch({ tmdbId, type = 'tv', season, episode, query }) {
  const body = { action: 'search', tmdbId };
  if (type === 'movie') body.type = 'movie';
  else {
    body.season = season;
    body.episode = episode;
  }
  if (query) body.query = query;
  const { status, data } = await seedPost('/api/subtitles', body);
  if (status === 403) throw new SeedApiError('字幕検索 403（x-cinelearn-seed 不一致/未設定）', { status, code: 'forbidden', data });
  if (status === 400 && (data?.code === 'unsupported_mode' || data?.error === 'Invalid action')) {
    throw new SeedApiError('本番 /api/subtitles は search を受け付けない（seed 向け search 廃止）', { status, code: 'search_unsupported', data });
  }
  if (status === 404) throw new SeedApiError('404: 本番に /api/subtitles が無い', { status, code: 'not_deployed', data });
  if (status === 429) throw new SeedApiError('字幕検索 429（rate_limited）', { status, code: 'rate_limited', data });
  if (status !== 200) throw new SeedApiError(`字幕検索 HTTP ${status}`, { status, code: 'api', data });
  return Array.isArray(data?.data) ? data.data : [];
}

// ダウンロード（seed 秘密ヘッダ必須）。生 SRT の文字列を返す。
export async function seedDownloadSrt(fileId) {
  const { status, data, text } = await seedPost('/api/subtitles', { action: 'download', fileId });
  if (status === 403) throw new SeedApiError('字幕 DL 403（x-cinelearn-seed 不一致/未設定・download は seed 限定）', { status, code: 'forbidden', data });
  if (status === 429) throw new SeedApiError('字幕 DL 429（rate_limited）', { status, code: 'rate_limited', data });
  if (status === 406 || data?.remaining === 0 || data?.reason === 'os_quota') {
    throw new SeedApiError('OpenSubtitles の DL 枠が上限（os_quota）', { status, code: 'os_quota', data });
  }
  if (status !== 200) throw new SeedApiError(`字幕 DL HTTP ${status}`, { status, code: 'api', data });
  // 正常時は text/plain の SRT 本文。JSON で返ってきたら link 無し等の失敗。
  if (data && typeof data === 'object') throw new SeedApiError('字幕 DL: 本文が取れない（link 無し）', { status, code: 'api', data });
  return text;
}

// ── subtitle_raw_cache（service_role 直）───────────────────────────────────
// キーは app/api/example・lib/server/subtitleRawCache.js と同じ 'tmdb{id}:s{S}e{E}'（映画は s0e0・版なし）。
export function rawCacheKey(tmdbId, season, episode) {
  return `tmdb${tmdbId}:s${season}e${episode}`;
}

function sbHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

// 未失効の行を返す（無い/失効/鍵未設定は null）。raw 本文はログに出さないこと。
export async function readRawCacheRow(cacheKey) {
  if (!SERVICE_KEY) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/subtitle_raw_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=cache_key,raw,provider,fetched_at,expires_at&limit=1`,
    { headers: sbHeaders(), cache: 'no-store' }
  );
  if (!res.ok) throw new SeedApiError(`subtitle_raw_cache read HTTP ${res.status}: ${await res.text()}`, { status: res.status, code: 'supabase' });
  const rows = JSON.parse(await res.text());
  const row = Array.isArray(rows) && rows[0];
  if (!row || !row.raw) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null; // TTL 失効＝無い扱い
  return row;
}

// 在庫の一覧（raw 本文は取らない＝メタだけ）。cache_key → { provider, fetched_at, expires_at, expired }。
// backfill-raw-cache.mjs の dry-run が「どの話に raw が無いか」を1クエリで出すために使う。
export async function listRawCacheMeta() {
  if (!SERVICE_KEY) throw new SeedApiError('SUPABASE_SERVICE_ROLE_KEY 未設定', { code: 'config' });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/subtitle_raw_cache?select=cache_key,provider,fetched_at,expires_at&limit=10000`, {
    headers: sbHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) throw new SeedApiError(`subtitle_raw_cache list HTTP ${res.status}: ${await res.text()}`, { status: res.status, code: 'supabase' });
  const rows = JSON.parse(await res.text());
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const expired = !!(r.expires_at && new Date(r.expires_at).getTime() < Date.now());
    map.set(r.cache_key, { provider: r.provider, fetched_at: r.fetched_at, expires_at: r.expires_at, expired });
  }
  return map;
}

// raw 行の upsert（既存は上書き＝呼び出し側で「未失効行はスキップ」を判定してから呼ぶ）。
// provider は A21 に合わせて 'opensubtitles:<file_id>'（どのファイルから来たかを残す）。
export async function upsertRawCacheRow({ tmdbId, season, episode, raw, fileId }) {
  if (!SERVICE_KEY) throw new SeedApiError('SUPABASE_SERVICE_ROLE_KEY 未設定', { code: 'config' });
  const now = Date.now();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/subtitle_raw_cache?on_conflict=cache_key`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    cache: 'no-store',
    body: JSON.stringify([
      {
        cache_key: rawCacheKey(tmdbId, season, episode),
        tmdb_id: tmdbId,
        season,
        episode,
        raw,
        provider: fileId ? `opensubtitles:${fileId}` : 'opensubtitles',
        fetched_at: new Date(now).toISOString(),
        expires_at: new Date(now + RAW_CACHE_TTL_MS).toISOString(),
      },
    ]),
  });
  if (!res.ok) throw new SeedApiError(`subtitle_raw_cache upsert HTTP ${res.status}: ${await res.text()}`, { status: res.status, code: 'supabase' });
}

// provider 'opensubtitles:<file_id>' から file_id を取り出す（旧行は 'opensubtitles' のみ＝null）。
export function fileIdOfProvider(provider) {
  const m = /^opensubtitles:(\d+)$/.exec(String(provider || ''));
  return m ? Number(m[1]) : null;
}

// 字幕テキストの採否（サーバ fetchEpisodeSrt と同基準・A5）: 歌詞ばかり／短すぎは次候補へ。
// 戻り値は不採用の理由（採用なら null）。
export function rejectReasonOfSrt(text) {
  if (!text) return 'empty';
  const musicRatio = (text.match(/♪/g) || []).length / (text.length / 100);
  if (musicRatio > 5) return 'music'; // 歌詞ばかりの字幕は除外
  if (parseSrt(text).length < 200) return 'short'; // 短すぎる字幕は信頼しない
  return null;
}

// ── 生 SRT の取得（raw cache 優先 → OpenSubtitles）────────────────────────
// 戻り値 { raw, fileId, via:'raw_cache'|'opensubtitles' } | null（字幕なし）。
// OS 経路は旧 fetchEpisodeSubtitle と同じ規則: 上位1候補・歌詞比率 >5 と整形後 200 字未満のときだけ次候補へ（最大3）。
// search が廃止されていた場合（S2 の判断次第）は raw cache に無い話を取れない＝ code:'search_unsupported' を投げる。
export async function seedFetchRawSrt({ tmdbId, type = 'tv', season, episode, query }, { preferRawCache = true } = {}) {
  const isMovie = type === 'movie';
  const s = isMovie ? 0 : season;
  const e = isMovie ? 0 : episode;
  if (preferRawCache) {
    const row = await readRawCacheRow(rawCacheKey(tmdbId, s, e));
    if (row) return { raw: row.raw, fileId: fileIdOfProvider(row.provider), via: 'raw_cache' };
  }
  const subs = await seedSearch({ tmdbId, type: isMovie ? 'movie' : 'tv', season: s, episode: e, query });
  const sorted = selectSubtitleCandidates(subs, isMovie, s, e);
  for (const cand of sorted.slice(0, 3)) {
    const fid = cand?.attributes?.files?.[0]?.file_id;
    if (!fid) continue;
    const text = await seedDownloadSrt(fid);
    if (rejectReasonOfSrt(text)) continue;
    return { raw: text, fileId: fid, via: 'opensubtitles' };
  }
  return null;
}
