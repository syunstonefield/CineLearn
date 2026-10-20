// 共有単語キャッシュ（vocab_cache）と厳選カタログ（catalog）の読み書き（§1・A2・A9・A23）。
//   * vocabCacheKey: 'v{VOCAB_CACHE_VERSION}:tmdb{id}:s{S}e{E}'。/api/vocab・/api/example・/api/claude・seed に散っていた
//     7箇所の複製をここへ集約（映画は常に s0e0）。
//   * readVocabRow: service_role で読む（anon の SELECT は 2026-10-15 に REVOKE 済み。鍵が無ければ anon）。DB 不調は miss と区別して { ok:false } を返す（1回だけ引き直す）。
//   * writeVocabRow: service_role。既存行は**絶対に触らない**（ignore-duplicates）。catalog へは enabled:false で
//     ignore-duplicates（既に enabled:true の行を false に戻さない＝A2）。contributed_by/at 列が無い DB では PGRST204 を
//     検知して列を外し1回だけ再送（旧 vocab-contribute の _provenanceUnsupported を移設＝A23）。
//   * contributedByOf: 'u:'/'ip:' + HMAC-SHA256(key=CL_HASH_PEPPER||CL_SEED_SECRET).slice(0,16)。鍵が無ければ null（列を書かない）。
//   * isInCatalog: CATALOG_GATE_ENABLED のときだけ照合。不調は fail-open（true）。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { createHmac } from 'node:crypto';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY,
  VOCAB_CACHE_VERSION,
  CATALOG_GATE_ENABLED,
  MAX_WORDS,
  VOCAB_MODEL,
} from './constants.js';

// 映画は常に s0e0・TV は正整数（不正/欠落は 1）。/api/vocab と同じ正規化。
export function normalizeEpisode(type, season, episode) {
  const isMovie = type === 'movie';
  return {
    type: isMovie ? 'movie' : 'tv',
    season: isMovie ? 0 : Number(season) || 1,
    episode: isMovie ? 0 : Number(episode) || 1,
  };
}

// cache_key。tmdbId が正整数でなければ null。
export function vocabCacheKey(tmdbId, type, season, episode) {
  const id = parseInt(tmdbId, 10);
  if (!id || id <= 0) return null;
  const n = normalizeEpisode(type, season, episode);
  return `v${VOCAB_CACHE_VERSION}:tmdb${id}:s${n.season}e${n.episode}`;
}

function anonHeaders(extra = {}) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, ...extra };
}
function svcHeaders(extra = {}) {
  return { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, ...extra };
}
// 読み取りの既定ヘッダ。2026-10-15: anon の SELECT を REVOKE した（公開 anon キーで vocab_cache を一括取得できる抜け道を塞ぐ・
// docs/decision-shared-translation-2026-10-14.md）ため、サーバは service_role で読む。鍵の無い環境（ローカル・seed の一部）だけ anon に落とす。
function readHeaders(extra = {}) {
  return SUPABASE_SERVICE_KEY ? svcHeaders(extra) : anonHeaders(extra);
}

// Supabase REST を読む。戻り値 { ok, rows }。失敗は1回だけ引き直し、それでも駄目なら ok:false（/api/vocab の sbSelect と同じ）。
//   ★ 旧実装は通信失敗も一律 miss 扱いで、DB が一瞬つまずいただけで再生成（¥7）に入っていた（2026-09-12 実測）。
export async function sbSelect(pathWithQuery, { headers = readHeaders(), fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, { headers, cache: 'no-store' });
      const rows = JSON.parse(await res.text());
      if (res.ok && Array.isArray(rows)) return { ok: true, rows };
    } catch {
      /* ネットワーク/JSON 失敗 → 再試行 */
    }
  }
  return { ok: false, rows: null };
}

export const VOCAB_ROW_SELECT = 'words,model,subtitle_provider,coverage_min,coverage_max,word_count,display_title';

// { ok:true, row: {...}|null } | { ok:false, row:null }（DB 不調＝miss ではない）
export async function readVocabRow(cacheKey, opts = {}) {
  if (!cacheKey) return { ok: true, row: null };
  const q = await sbSelect(`vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=${VOCAB_ROW_SELECT}&limit=1`, opts);
  if (!q.ok) return { ok: false, row: null };
  const row = q.rows[0];
  if (row && Array.isArray(row.words) && row.words.length) return { ok: true, row };
  return { ok: true, row: null };
}

// /api/vocab の meta と同形。
export function vocabRowMeta(row) {
  return {
    model: row?.model ?? null,
    provider: row?.subtitle_provider ?? null,
    coverage: [row?.coverage_min ?? null, row?.coverage_max ?? null],
    wordCount: row?.word_count ?? (Array.isArray(row?.words) ? row.words.length : null),
  };
}

// カタログ照合。ゲート無効なら常に true。service_role は RLS を通らないので enabled をクエリで明示する。不調は fail-open。
export async function isInCatalog(tmdbId, { gateEnabled = CATALOG_GATE_ENABLED, fetchImpl = fetch } = {}) {
  if (!gateEnabled) return true;
  const id = parseInt(tmdbId, 10);
  if (!id) return false;
  const cat = await sbSelect(`catalog?tmdb_id=eq.${id}&enabled=is.true&select=tmdb_id&limit=1`, { fetchImpl });
  if (!cat.ok) return true; // 一時障害で「近日対応」を出さない
  return cat.rows.length > 0;
}

export function coverageRange(words) {
  const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const idxs = (words || []).map((w) => order.indexOf(String(w?.level || '').toUpperCase())).filter((i) => i >= 0);
  if (!idxs.length) return { min: null, max: null };
  return { min: order[Math.min(...idxs)], max: order[Math.max(...idxs)] };
}

// 投稿元の識別子（A9）。汚染行を同じ投稿元ごと消せるように残す（生の uid/IP は保存しない）。
//   key = CL_HASH_PEPPER、無ければ CL_SEED_SECRET、どちらも無ければ null（列を書かない）。
export function contributedByOf({ uid, ip }, env = process.env) {
  const key = env.CL_HASH_PEPPER || env.CL_SEED_SECRET || '';
  if (!key) return null;
  const h = (s) => createHmac('sha256', key).update(String(s)).digest('hex').slice(0, 16);
  if (uid) return `u:${h(uid)}`;
  if (ip) return `ip:${h(ip)}`;
  return null;
}

// contributed_by/at 列が無い DB（PGRST204）を1回検知したら以後は列を付けない（デプロイ順に依存しない）。
let _provenanceUnsupported = false;
// subtitle_file_id / episode_match 列が無い DB（SQL 適用前）も同じ方式で検知して以後は付けない（2026-10-20 /decide D）。
let _subtitleSourceUnsupported = false;
function isMissingColumn(status, text) {
  return status === 400 && /PGRST204|contributed_(by|at)|subtitle_file_id|episode_match/.test(text || '');
}
export function _resetProvenanceFlagForTests() {
  _provenanceUnsupported = false;
  _subtitleSourceUnsupported = false;
}

// vocab_cache への書込（既存行は触らない）。
//   入力: { tmdbId, type, season, episode, displayTitle, titleNorm?, words, subtitleProvider, model?, contributedBy?, catalogEnabled? }
//   戻り値: { written:true, count, cacheKey } | { skipped:'no-service-key'|'bad-input'|'exists', cacheKey }
//   投げる: Error('write-failed:<status>')（内部ステータスはログのみ・クライアントには返さない）
//   ★ catalog は enabled:false で ignore-duplicates（既存行＝手動昇格済みの enabled:true を絶対に戻さない・A2）。
//     seed が enabled:true で登録する経路は seed 側の直接 upsert のまま（catalogEnabled:true を渡せば同じ形で書く）。
export async function writeVocabRow(input, { fetchImpl = fetch, log = console, now = Date.now } = {}) {
  const id = parseInt(input?.tmdbId, 10);
  const n = normalizeEpisode(input?.type, input?.season, input?.episode);
  const cacheKey = vocabCacheKey(id, n.type, n.season, n.episode);
  if (!SUPABASE_SERVICE_KEY) return { skipped: 'no-service-key', cacheKey };
  const words = Array.isArray(input?.words) ? input.words : [];
  if (!cacheKey || !words.length || words.length > MAX_WORDS) return { skipped: 'bad-input', cacheKey };

  // 冪等：既に在れば書かない（良いキャッシュ／シードを守る）。確認失敗時は続行（下の書込は ignore-duplicates なので安全）。
  const exists = await sbSelect(`vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=cache_key&limit=1`, { fetchImpl });
  if (exists.ok && exists.rows.length) return { skipped: 'exists', cacheKey };

  const store = words.map(({ example_ja_ok, ...w }) => w); // transient フラグ除去
  const cov = coverageRange(store);
  const headers = svcHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' });
  const nowIso = new Date(now()).toISOString();

  // カタログ登録（enabled:false・既存行は触らない）。失敗しても vocab_cache の書込は続ける。
  try {
    const catRes = await fetchImpl(`${SUPABASE_URL}/rest/v1/catalog?on_conflict=tmdb_id`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify([
        {
          tmdb_id: id,
          display_title: input.displayTitle || null,
          title_norm: input.titleNorm || null,
          type: n.type,
          enabled: input.catalogEnabled === true,
        },
      ]),
    });
    if (!catRes.ok) log.warn?.('[CL:VOCABCACHE] catalog insert failed', catRes.status);
  } catch (err) {
    log.warn?.('[CL:VOCABCACHE] catalog insert exception', String(err?.message || err));
  }

  const row = {
    cache_key: cacheKey,
    cache_version: VOCAB_CACHE_VERSION,
    tmdb_id: id,
    season: n.season,
    episode: n.episode,
    display_title: input.displayTitle || null,
    title_norm: input.titleNorm || null,
    words: store,
    word_count: store.length,
    coverage_min: cov.min,
    coverage_max: cov.max,
    subtitle_provider: input.subtitleProvider || 'opensubtitles(server)',
    model: input.model || VOCAB_MODEL,
    updated_at: nowIso,
  };
  if (!_provenanceUnsupported && input.contributedBy) {
    row.contributed_by = input.contributedBy;
    row.contributed_at = nowIso;
  }
  // 生成に使った字幕ファイル（2026-10-20 /decide D）。サーバだけが読む列（anon に GRANT しない）。
  const fid = parseInt(input.subtitleFileId, 10);
  if (!_subtitleSourceUnsupported && fid > 0) {
    row.subtitle_file_id = fid;
    if (['exact', 'unknown', 'fallback'].includes(input.episodeMatch)) row.episode_match = input.episodeMatch;
  }
  const post = () =>
    fetchImpl(`${SUPABASE_URL}/rest/v1/vocab_cache?on_conflict=cache_key`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify([row]),
    });
  let res;
  try {
    res = await post();
    // 列がまだ無い DB → その列なしで再送（寄与そのものは止めない）。足りない列ごとに最大2回。
    for (let i = 0; i < 2 && !res.ok; i++) {
      const text = await res.text().catch(() => '');
      if (!isMissingColumn(res.status, text)) break;
      if (/subtitle_file_id|episode_match/.test(text) && 'subtitle_file_id' in row) {
        _subtitleSourceUnsupported = true;
        delete row.subtitle_file_id;
        delete row.episode_match;
      } else if ('contributed_by' in row) {
        _provenanceUnsupported = true;
        delete row.contributed_by;
        delete row.contributed_at;
      } else if ('subtitle_file_id' in row) {
        _subtitleSourceUnsupported = true;
        delete row.subtitle_file_id;
        delete row.episode_match;
      } else break;
      res = await post();
    }
  } catch (err) {
    log.error?.('[CL:VOCABCACHE] write exception', cacheKey, String(err?.message || err));
    throw new Error('write-failed:0');
  }
  if (!res.ok) {
    log.error?.('[CL:VOCABCACHE] write failed', cacheKey, res.status);
    throw new Error(`write-failed:${res.status}`);
  }
  log.info?.(`[CL:VOCABCACHE] wrote ${cacheKey} words=${store.length} by=${row.contributed_by ? row.contributed_by.slice(0, 5) + '…' : '-'}`);
  return { written: true, count: store.length, cacheKey };
}

// 生成に使った字幕ファイルの記録を読む（手動追加の取り直し専用・2026-10-20 /decide D）。
//   VOCAB_ROW_SELECT（/api/vocab 等の共通の読み）には混ぜない＝列が無い DB で共通の読みが 400 で止まらない。
//   → { fileId, episodeMatch } | null（記録なし・列なし・DB 不調はすべて null＝従来どおり検索する）
export async function readSubtitleSource(cacheKey, { fetchImpl = fetch } = {}) {
  if (!cacheKey || !SUPABASE_SERVICE_KEY) return null;
  const r = await sbSelect(
    `vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=subtitle_file_id,episode_match&limit=1`,
    { headers: svcHeaders(), fetchImpl }
  );
  const row = r.ok ? r.rows[0] : null;
  const fileId = parseInt(row?.subtitle_file_id, 10);
  if (!(fileId > 0)) return null;
  return { fileId, episodeMatch: row.episode_match || null };
}

// OS から消えた（404/410）ファイルの記録を消す。同じ番号の時だけ消す（別の番号に置き換わっていたら触らない）。
//   権利者の申立て等で消えたファイルを再び使わないため（法務 R1）。
export async function clearSubtitleFileId(cacheKey, fileId, { fetchImpl = fetch, log = console } = {}) {
  const fid = parseInt(fileId, 10);
  if (!cacheKey || !(fid > 0) || !SUPABASE_SERVICE_KEY) return false;
  try {
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&subtitle_file_id=eq.${fid}`,
      {
        method: 'PATCH',
        headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        cache: 'no-store',
        body: JSON.stringify({ subtitle_file_id: null, episode_match: null }),
      }
    );
    if (!res.ok) log.warn?.('[CL:VOCABCACHE] clear file_id failed', cacheKey, res.status);
    return res.ok;
  } catch (err) {
    log.warn?.('[CL:VOCABCACHE] clear file_id exception', cacheKey, String(err?.message || err));
    return false;
  }
}

// 旧形式（word）と短縮形（w）の両方から語だけを取り出す（lib/vocab.js expandShortKeys と同じ互換規則）。
export function wordStrings(words) {
  if (!Array.isArray(words)) return [];
  const out = new Set();
  for (const w of words) {
    const s = String(w?.word ?? w?.w ?? '').trim().toLowerCase();
    if (s) out.add(s);
  }
  return [...out];
}

// 字幕マーカー＋ポップアップ即時表示用: 語・日本語の意味・品詞だけ（例文・レベル・チャンクは配らない）。
// 意味は自前の生成文（字幕本文ではない）。長すぎる定義は 80 字で切る（ポップアップ1行分）。
export function wordMeanings(words) {
  if (!Array.isArray(words)) return [];
  const seen = new Set();
  const out = [];
  for (const w of words) {
    const s = String(w?.word ?? w?.w ?? '').trim().toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const d = String(w?.definition ?? w?.d ?? '').trim().slice(0, 80);
    const p = String(w?.pos ?? w?.p ?? '').trim().slice(0, 20);
    out.push(d ? { w: s, d, p } : { w: s });
  }
  return out;
}
