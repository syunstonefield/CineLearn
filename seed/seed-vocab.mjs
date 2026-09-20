// 共有単語キャッシュのシードスクリプト（Phase 0 / A：リーン版）。
//
// 何をするか（2026-09-12・design-B §5 / A14 で経路を一本化）:
//   TARGETS の各エピソードについて
//     POST /api/vocab-generate（x-cinelearn-seed 付き・1話1回）
//       ＝ サーバ内で 字幕取得→解析→Haiku→tsSec 付与→品質/coverage ゲート→vocab_cache 書込 まで完結
//     → 応答 words に fillMissingExampleJa（和訳補完・mode:'sentences'＝共有キャッシュ経由）
//     → seed 自身も行の空欄 example_ja を PATCH（サーバ側の後埋めと同じ「空欄しか触らない」規則）
//     → catalog を enabled:true に昇格（Supabase 直接・従来どおり）
//   生 SRT はもう seed に降りてこない（30条の4 の内部解析はサーバ内で閉じる）。
//   生成ロジック（プロンプト/整形/tsSec）は next-app/lib をサーバが使う＝ seed 側の複製はゼロ。
//
// 実行（要：拡張子なし import を解決するフック）:
//   node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/seed-vocab.mjs
//
//   必要 env（seed/.env）:
//     SUPABASE_SERVICE_ROLE_KEY / CINELEARN_API_BASE / CINELEARN_API_ORIGIN / CL_SEED_SECRET
//     CINELEARN_API_BASE・ORIGIN は https://cinelearn-next.vercel.app（旧 cine-learn は 307 転送殻）。
//     VOCAB_CACHE_VERSION は本番 Vercel の値と一致させる（本番は 2）。
//   ※ x-cinelearn-seed は本番のカタログゲート・レート制限の免除に使う（base が cinelearn-next 以外なら付けない）。
//   ※ 書き込み（空欄 PATCH・catalog 昇格）は service_role（RLS バイパス）。キーは絶対にコミットしない。
//   ※ 1話の生成は最長 240 秒（サーバの予算・A1）。409 busy は retryAfterSec 待ち、502/504 は 60 秒後に最大 2 回。

import { fillMissingExampleJa } from '../next-app/lib/vocab.js';
import {
  API_BASE,
  API_ORIGIN,
  SUPABASE_URL,
  SeedApiError,
  isFatal,
  seedPost,
  seedSecretApplies,
  sleep,
  warnIfSeedHeaderMissing,
} from './lib/osdl.mjs';

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CACHE_VERSION = Number(process.env.VOCAB_CACHE_VERSION || 1);
const VOCAB_COUNT = 40; // 従来どおり（サーバの受理範囲 20〜60）
const GENERATE_TIMEOUT_MS = 300_000; // サーバの予算 240s（A1）＋往復の余裕
const UPSTREAM_RETRY_WAIT_MS = 60_000; // 502/504/503 は 60 秒後に再試行（A14）
const UPSTREAM_RETRY_MAX = 2;
const BUSY_WAIT_TOTAL_MAX_MS = 300_000; // 409 busy の待ち合計上限（ロック TTL と同じ 300 秒）

// 指定シーズンの episode 範囲を [{season,episode}...] に展開するヘルパー。
const eps = (season, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ season, episode: from + i }));

// ── シード対象 ──
// ※ 実在しない回（範囲を超えた episode）は字幕が見つからず自動スキップ（nosub・Claude 消費なし）。
// ※ 週30話上限・単一作品を短期集中で埋めない（docs/design-curated-catalog.md §5・legal R2）。
//   → 1作品4話×7作品＋映画1本＝29話/週。翌週以降は各作品の続き＋リクエスト上位を足す。
// ※ tmdb_id は 2026-07-07 に本番 /api/tmdb で実確認済み。
//   作品名（title/englishTitle/display）はログ用途のみ（サーバは TMDB 解決値を使う・A6）。
const TARGETS = [
  { tmdbId: 66732, title: 'Stranger Things', englishTitle: 'Stranger Things', display: 'Stranger Things', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 1396, title: 'Breaking Bad', englishTitle: 'Breaking Bad', display: 'Breaking Bad', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 82596, title: 'Emily in Paris', englishTitle: 'Emily in Paris', display: 'Emily in Paris', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 66573, title: 'The Good Place', englishTitle: 'The Good Place', display: 'The Good Place', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 1421, title: 'Modern Family', englishTitle: 'Modern Family', display: 'Modern Family', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 65494, title: 'The Crown', englishTitle: 'The Crown', display: 'The Crown', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 77169, title: 'Cobra Kai', englishTitle: 'Cobra Kai', display: 'Cobra Kai', type: 'tv', episodes: eps(1, 1, 4) },
  // 映画（続編2026公開の便乗枠・marketing R1）
  { tmdbId: 350, title: 'The Devil Wears Prada', englishTitle: 'The Devil Wears Prada', display: 'プラダを着た悪魔', type: 'movie', episodes: [{ season: 0, episode: 0 }] },
];

function fail(msg) {
  console.error('✖', msg);
  process.exit(1);
}
if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY が未設定です（Supabase の service_role キー）。');
if (!API_BASE) fail('CINELEARN_API_BASE 未設定（例: https://cinelearn-next.vercel.app）。生成は本番 API を叩きます。');
if (!API_ORIGIN) fail('CINELEARN_API_ORIGIN 未設定（例: https://cinelearn-next.vercel.app）。本番 API の Origin ゲートを通すため必要。');
warnIfSeedHeaderMissing();

const titleNorm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '_');
const keyOf = (s) => String(s || '').trim().slice(0, 300); // 文の同一性（サーバのハッシュ入力と同じ正規化）

const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// service_role で upsert（on_conflict で重複は更新）。catalog の昇格に使う。
async function sbUpsert(table, rows, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table} upsert 失敗 HTTP ${res.status}: ${await res.text()}`);
}

// 行の words だけ読む（無ければ null）。
async function readRowWords(cacheKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=cache_key,words,updated_at&limit=1`,
    { headers: sbHeaders, cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`vocab_cache read 失敗 HTTP ${res.status}: ${await res.text()}`);
  const rows = JSON.parse(await res.text());
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// 既にキャッシュ済みならスキップ（週次の再実行で二重生成＝二重課金を防ぐ）。
async function isCached(cacheKey) {
  return !!(await readRowWords(cacheKey));
}

// 行の空欄 example_ja だけを seed 側の訳で埋める（backfill-example-ja.mjs と同じ規則・A14）。
// サーバも応答後 after() で同じ空欄を埋めるので、行を読み直して「まだ空欄のもの」だけ書く
// ＝競合しても双方が空欄しか触らない。戻り値 { filled, left } / 行が無ければ null。
async function patchExampleJaBlanks(cacheKey, localWords) {
  const jaByExample = new Map();
  for (const w of localWords) if (w?.example && w.example_ja) jaByExample.set(keyOf(w.example), w.example_ja);
  const row = await readRowWords(cacheKey);
  if (!row) return null;
  const words = Array.isArray(row.words) ? row.words : [];
  let filled = 0;
  for (const w of words) {
    if (!w?.example || w.example_ja) continue;
    const ja = jaByExample.get(keyOf(w.example));
    if (!ja) continue;
    w.example_ja = ja;
    filled++;
  }
  if (filled) {
    // サーバの after()（patchVocabCacheExampleJa）と同時に走ると後勝ちで相手の埋めを巻き戻すので、
    // 読んだ updated_at を条件にした CAS にする（0行＝負け → 呼び出し側が再実行すれば読み直して再適用）。
    const cas = row.updated_at ? `&updated_at=eq.${encodeURIComponent(row.updated_at)}` : '';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}${cas}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ words, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`vocab_cache PATCH 失敗 HTTP ${res.status}: ${await res.text()}`);
    const updated = JSON.parse(await res.text().catch(() => '[]'));
    if (!Array.isArray(updated) || !updated.length) {
      console.warn('   ⚠ example_ja の空欄 PATCH が競合で見送り（サーバ側が先に更新）。再実行で埋まります');
      return { filled: 0, left: words.filter((w) => w?.example && !w.example_ja).length };
    }
  }
  const left = words.filter((w) => w?.example && !w.example_ja).length;
  return { filled, left };
}

// /api/vocab-generate を 1 話ぶん叩き、応答を分類して返す。
//   { kind:'hit'|'generated', words, meta } / { kind:'nosub'|'blocked' } / { kind:'nogen', reason }
// 再試行規則（A14）: 409 busy → retryAfterSec 待ち（合計 300 秒まで）／502・503・504・通信断 → 60 秒後に最大 2 回。
// それ以外（403/404/429/400）は設定ミスとして SeedApiError（FATAL は main が走査を止める）。
async function generateViaApi(body) {
  let upstreamRetries = 0;
  let busyWaited = 0;
  for (;;) {
    let res;
    try {
      res = await seedPost('/api/vocab-generate', body, { timeoutMs: GENERATE_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof SeedApiError) throw err; // config / redirect はそのまま
      // fetch 自体の失敗（タイムアウト・接続断）は 504 相当として扱う
      if (upstreamRetries >= UPSTREAM_RETRY_MAX) throw new Error(`vocab-generate 通信失敗（${err.name}）が続いた`);
      upstreamRetries++;
      console.warn(`  ⚠ 通信失敗（${err.name}）→ ${UPSTREAM_RETRY_WAIT_MS / 1000}s 後に再試行 ${upstreamRetries}/${UPSTREAM_RETRY_MAX}`);
      await sleep(UPSTREAM_RETRY_WAIT_MS);
      continue;
    }
    const { status, data } = res;
    if (status === 200) {
      if (data?.blocked) return { kind: 'blocked' };
      if (data?.nosub) return { kind: 'nosub' };
      if (data?.hit) return { kind: 'hit', words: Array.isArray(data.words) ? data.words : [], meta: data.meta || {} };
      if (data?.generated) return { kind: 'generated', words: Array.isArray(data.words) ? data.words : [], meta: data.meta || {} };
      if (data && data.generated === false) return { kind: 'nogen', reason: data.reason || '-' };
      throw new Error('vocab-generate: 想定外の応答形（hit/generated/nosub/blocked のいずれも無い）');
    }
    if (status === 409) {
      const waitMs = Math.max(1, Number(data?.retryAfterSec) || 8) * 1000;
      if (busyWaited + waitMs > BUSY_WAIT_TOTAL_MAX_MS) throw new Error('409 busy が続く（ロック待ち合計が上限）→ 後で再実行');
      busyWaited += waitMs;
      console.log(`  ⏳ 同じ話を生成中（409 busy${data?.ttlSec ? `・残り約${data.ttlSec}s` : ''}）→ ${waitMs / 1000}s 待って再試行`);
      await sleep(waitMs);
      continue;
    }
    if (status === 502 || status === 503 || status === 504) {
      const reason = data?.reason || data?.error || `HTTP ${status}`;
      if (reason === 'os_quota') {
        throw new SeedApiError('OpenSubtitles の DL 枠が上限（os_quota）→ 本日は中止', { status, code: 'os_quota', data });
      }
      if (upstreamRetries >= UPSTREAM_RETRY_MAX) throw new Error(`上流失敗（${reason}）が ${UPSTREAM_RETRY_MAX + 1} 回続いた`);
      upstreamRetries++;
      console.warn(`  ⚠ 上流失敗（${reason}）→ ${UPSTREAM_RETRY_WAIT_MS / 1000}s 後に再試行 ${upstreamRetries}/${UPSTREAM_RETRY_MAX}`);
      await sleep(UPSTREAM_RETRY_WAIT_MS);
      continue;
    }
    if (status === 429) {
      throw new SeedApiError(
        `429 rate_limited（scope=${data?.scope || '-'}）。seed は免除のはず＝x-cinelearn-seed が効いていない（CL_SEED_SECRET と Vercel env の一致を確認）`,
        { status, code: 'rate_limited', data }
      );
    }
    if (status === 403) throw new SeedApiError('403 forbidden（Origin ゲート／秘密ヘッダを確認）', { status, code: 'forbidden', data });
    if (status === 404) throw new SeedApiError('404: 本番に /api/vocab-generate が無い（デプロイ前？）', { status, code: 'not_deployed', data });
    const detail = typeof data?.error === 'string' ? data.error : data?.error?.message || '';
    throw new SeedApiError(`vocab-generate HTTP ${status}${detail ? ` (${detail})` : ''}`, { status, code: 'api', data });
  }
}

// 戻り値は結果の種別（集計用）: 'ok' | 'skipped' | 'nosub' | 'blocked' | 'nogen' | 'rejected'
async function seedEpisode(t, season, episode) {
  const s = t.type === 'movie' ? 0 : season;
  const e = t.type === 'movie' ? 0 : episode;
  const cacheKey = `v${CACHE_VERSION}:tmdb${t.tmdbId}:s${s}e${e}`;
  console.log(`\n▶ ${t.display} S${season}E${episode}  (${cacheKey})`);
  if (await isCached(cacheKey)) {
    console.log('  ⏭ キャッシュ済み → スキップ（生成・クォータ消費なし）');
    return 'skipped';
  }

  const started = Date.now();
  const r = await generateViaApi({
    tmdbId: t.tmdbId,
    type: t.type,
    season: s,
    episode: e,
    title: t.title,
    englishTitle: t.englishTitle,
    displayTitle: t.display,
    vocabCount: VOCAB_COUNT,
  });
  const secs = Math.round((Date.now() - started) / 1000);
  if (r.kind === 'nosub') {
    console.warn(`  ⚠ 字幕なし（nosub・${secs}s）→ スキップ`);
    return 'nosub';
  }
  if (r.kind === 'blocked') {
    console.warn('  ⚠ カタログゲートで blocked（seed は免除のはず＝x-cinelearn-seed が効いていない疑い）→ スキップ');
    return 'blocked';
  }
  if (r.kind === 'nogen') {
    console.warn(`  ⚠ 直近の失敗が記憶されている（nogen: ${r.reason}）→ スキップ（最長1時間後に再実行）`);
    return 'nogen';
  }

  const { words, meta } = r;
  const dramaCount = words.filter((w) => w.source === 'drama').length;
  console.log(
    `  ${r.kind === 'hit' ? 'キャッシュ命中（他経路で生成済み）' : `生成 ${secs}s`}: ${words.length} 語` +
      `（drama ${dramaCount} / plus ${words.length - dramaCount}・coverage ${meta.coverage ?? '-'}・model ${meta.model ?? '-'}）`
  );
  // 品質/coverage ゲート不通過はサーバが行を書かない（words は返る）。行が無い以上、和訳の PATCH も
  // catalog 昇格もしない（作品を「対応済み」に見せない）。
  if (r.kind === 'generated' && meta.contributed === false) {
    console.warn(`  ⚠ 品質/coverage ゲート不通過（${meta.reason || '-'}）→ 共有キャッシュには書かれていない（catalog 昇格も見送り）`);
    return 'rejected';
  }

  // 例文和訳（mode:'sentences'＝共有キャッシュ経由・未命中だけサーバが Haiku で訳す）。
  // ctx を渡すとサーバ側も行の空欄を埋める。'sentences' のレート枠（100/時）に当たると残りは未訳のまま
  // ＝ seed 自身も空欄 PATCH を行い、残数を出す（量が多い時は backfill-example-ja.mjs で後追い）。
  await fillMissingExampleJa(words, { tmdbId: t.tmdbId, season: s, episode: e, type: t.type, rowWords: words });
  const patched = await patchExampleJaBlanks(cacheKey, words);
  if (!patched) {
    console.warn(`  ⚠ 行 ${cacheKey} が見つからない（VOCAB_CACHE_VERSION=${CACHE_VERSION} が本番と不一致？）→ 和訳 PATCH 見送り`);
  } else {
    console.log(
      `  例文和訳: seed から ${patched.filled} 語を追記・残り空欄 ${patched.left} 語` +
        (patched.left ? '（backfill-example-ja.mjs で後追い可）' : '')
    );
  }

  // カタログ昇格（従来どおり Supabase 直接・enabled:true）。サーバは enabled:false で INSERT するだけ（A2）。
  await sbUpsert(
    'catalog',
    [{ tmdb_id: t.tmdbId, title_norm: titleNorm(t.title), display_title: t.display, type: t.type, enabled: true }],
    'tmdb_id'
  );
  console.log('  ✅ vocab_cache 書込済み（サーバ側）・catalog を enabled:true に昇格');
  return 'ok';
}

async function main() {
  // SEED_MAX_EPISODES=N でN話処理したら停止（パイロット実行・週次上限の分割消化用）
  const maxEps = Number(process.env.SEED_MAX_EPISODES || 0);
  console.log(
    `シード開始（cache_version=${CACHE_VERSION}, base=${API_BASE}, seed_header=${seedSecretApplies() ? 'on' : 'off'}${maxEps ? `, max=${maxEps}話` : ''}）`
  );
  const counts = {};
  const bump = (k) => (counts[k] = (counts[k] || 0) + 1);
  let done = 0;
  outer: for (const t of TARGETS) {
    for (const ep of t.episodes) {
      if (maxEps && done >= maxEps) break outer;
      done++;
      try {
        bump(await seedEpisode(t, ep.season, ep.episode));
      } catch (err) {
        bump('failed');
        console.error('  ❌', err.message);
        if (isFatal(err)) {
          console.error(`✖ 続行しても同じ失敗になる（${err.code}）→ 走査を中止`);
          break outer;
        }
      }
    }
  }
  const summary = Object.entries(counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(' / ');
  console.log(`\n完了：${summary || '対象なし'}`);
}

main();
