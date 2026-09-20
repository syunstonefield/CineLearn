// サーバ側の単語リスト生成ルート（B・§2・A1/A3/A5/A6/A12/A15）。2026-09-12 新設。
//   旧経路（クライアントが /api/subtitles download で生SRTを取り、プロンプトを自分で組んで /api/claude 既定モードへ
//   送り、/api/vocab-contribute に投稿する）を丸ごとサーバ内に畳んだ。クライアントへ返すのは words だけ＝
//   生SRT・整形本文は一切配らない（30条の4 の内部解析）。プロンプトもサーバが組む（任意プロンプト実行の根絶）。
//
// 手順（A3 の順序。cache-first より前にゲート＝enabled:false の作品を直接呼びで配らない）:
//   1 検証 → 2 resolveUserId・seed/admin 判定 → 3 カタログゲート → 4 cache-first（命中は計数しない）
//   → 5 nogen（否定キャッシュ）→ 6 ロック存在確認（409・レート制限を触らない）→ 7 レート制限（1話=1カウント）
//   → 8 SET NX でロック取得 → 9 生成 → 10 vocab_cache 書込（await・応答前に完了）→ 11 finally 解放
//
// 応答（lib/api.js generateEpisodeVocab がこの形で分岐する）:
//   200 { hit:true, words, meta }                         … 共有キャッシュ命中（計数なし）
//   200 { hit:false, generated:true, words, meta }        … 生成した（meta.contributed=false は共有されなかった）
//   200 { hit:false, generated:false, reason }            … 否定キャッシュ（直近の失敗・品質不通過・連続失敗）
//   200 { blocked:true }                                  … カタログ外（ゲート有効時）
//   200 { nosub:true }                                    … 字幕なし（枠は消費する＝存在しない tmdbId で OS 検索を回させない）
//   409 { busy:true, retryAfterSec, ttlSec }              … 同じ話を他の人が生成中
//   429 { error:'rate_limited', scope, window, resetAtUtc, limit, loginHint }
//   503 { error:'unavailable' }                           … Upstash 不調（vocab は failClosed）／DB 不調
//   502 { error:'upstream', reason }                      … tmdb / os_* / llm / timeout / generation
// ★ログにプロンプト・raw・parsed・LLM 応答本文を出さない（A20）。id・件数・所要のみ。

export const dynamic = 'force-dynamic';

import { randomBytes } from 'crypto';
import { allowedOrigin } from '@/lib/server/origin';
import { resolveUserId, isAdmin, isSeedRequest } from '@/lib/server/auth';
import { checkRateLimit, clientIp } from '@/lib/ratelimit';
import { redisGet, redisSet, redisCommand, redisDelIfEquals, redisIncrWithTtl, tryRedis, upstashConfigured } from '@/lib/server/upstash';
import {
  normalizeEpisode,
  vocabCacheKey,
  readVocabRow,
  vocabRowMeta,
  isInCatalog,
  writeVocabRow,
  contributedByOf,
} from '@/lib/server/vocabCache';
import { generateEpisodeVocab, clampVocabCount } from '@/lib/server/vocabGen';
import {
  VOCAB_LIMITS,
  GENERATE_DEADLINE_MS,
  VOCAB_LOCK_TTL_SEC,
  NOGEN_TTL_SEC,
  NOGEN_TIMEOUT_TTL_SEC,
  FAIL_COUNT_TTL_SEC,
  FAIL_COUNT_MAX,
  BUSY_RETRY_AFTER_SEC,
  UpstreamError,
} from '@/lib/server/constants';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 入力のホワイトリスト化（cachedJsonMode の cleanStr と同じ作法）。title 系はログ用途のみで生成には使わない（A6）。
const cleanStr = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// TV の話数の受理範囲（任意の (S,E) 組で OS 検索を回させない・レビュー指摘）。
const SEASON_MAX = 60;
const EPISODE_MAX = 400;

// クライアントへ返してよい失敗理由。misconfigured（鍵の欠落）や write-*（DB/鍵の状態）は偵察材料になるので
// 'internal' に丸める（ログには元の値を残す）。
const PUBLIC_REASONS = new Set([
  'nosub', 'gate', 'coverage', 'os_quota', 'os_search', 'os_download', 'tmdb', 'llm', 'timeout', 'generation', 'repeated_failure',
]);
const publicReason = (r) => (PUBLIC_REASONS.has(r) ? r : 'internal');

const lockKey = (cacheKey) => `lock:vocab:${cacheKey}`;
const nogenKey = (cacheKey) => `nogen:vocab:${cacheKey}`;
const failKey = (cacheKey) => `fail:vocab:${cacheKey}`;

// 失敗の記録（A1）: 否定キャッシュ＋連続失敗カウント。待たされた側が同じ失敗を人数分繰り返さないための天井。
async function recordFailure(cacheKey, reason, { log = console } = {}) {
  const ttl = reason === 'timeout' ? NOGEN_TIMEOUT_TTL_SEC : NOGEN_TTL_SEC;
  await tryRedis(() => redisSet(nogenKey(cacheKey), reason, { ex: ttl }), null, { log });
  await tryRedis(() => redisIncrWithTtl(failKey(cacheKey), FAIL_COUNT_TTL_SEC), null, { log });
}

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // ── 1) 検証 ──
  const id = posInt(body?.tmdbId);
  if (!id) return json({ error: 'tmdbId is required' }, 400);
  const type = body?.type === 'movie' ? 'movie' : 'tv';
  // 映画はサーバ側で s0e0 に正規化（A15）。TV だけ正整数を要求（クライアントの状態値 1/1 も通る）。
  if (type === 'tv' && (!posInt(body?.season) || !posInt(body?.episode))) {
    return json({ error: 'season/episode must be positive integers for tv' }, 400);
  }
  if (type === 'tv' && (Number(body.season) > SEASON_MAX || Number(body.episode) > EPISODE_MAX)) {
    return json({ error: 'season/episode out of range' }, 400);
  }
  const n = normalizeEpisode(type, body?.season, body?.episode);
  const vocabCount = clampVocabCount(body?.vocabCount);
  const cacheKey = vocabCacheKey(id, n.type, n.season, n.episode);
  if (!cacheKey) return json({ error: 'bad request' }, 400);
  const epLabel = n.type === 'movie' ? `tmdb${id} movie` : `tmdb${id} s${n.season}e${n.episode}`;
  const titleForLog = cleanStr(body?.englishTitle || body?.title, 120); // ログ用途のみ

  // ── 2) 呼び出し主体 ──
  const auth = await resolveUserId(req);
  const uid = auth.uid || null;
  const seed = isSeedRequest(req);
  const privileged = seed || isAdmin(uid);

  // ── 3) カタログゲート（サーバ側・cl_catalog_admin のクライアント側バイパスを無効化）──
  if (!privileged && !(await isInCatalog(id))) return json({ blocked: true });

  // ── 4) cache-first（命中は計数しない・/api/vocab と同形）──
  const cached = await readVocabRow(cacheKey);
  if (!cached.ok) {
    // DB 不調＝miss ではない。生成しても書けないので課金せず 503（クライアントは「混雑」文言）。
    console.warn('[CL:VOCABGEN] vocab_cache unavailable', cacheKey);
    return json({ error: 'unavailable' }, 503);
  }
  if (cached.row) return json({ hit: true, words: cached.row.words, meta: vocabRowMeta(cached.row) });

  // ── 5) 否定キャッシュ（直近の失敗・品質不通過・連続失敗）──
  const nogen = await tryRedis(() => redisGet(nogenKey(cacheKey)), null);
  if (nogen) return json({ hit: false, generated: false, reason: publicReason(nogen) });
  const failCount = Number(await tryRedis(() => redisGet(failKey(cacheKey)), null)) || 0;
  if (failCount > FAIL_COUNT_MAX) return json({ hit: false, generated: false, reason: 'repeated_failure' });

  // ── 6) ロック存在確認（レート制限を触らない＝busy ポーリングで INCR/DECR を回さない）──
  const lk = lockKey(cacheKey);
  if (await tryRedis(() => redisGet(lk), null)) {
    const ttl = Number(await tryRedis(() => redisCommand(['TTL', lk]), null));
    return json(
      { busy: true, retryAfterSec: BUSY_RETRY_AFTER_SEC, ttlSec: Number.isFinite(ttl) && ttl > 0 ? ttl : VOCAB_LOCK_TTL_SEC },
      409
    );
  }

  // ── 7) レート制限（1話=1カウント・チャンク数に依らない。seed/admin は免除）──
  let release = async () => {};
  if (!privileged) {
    const rl = uid
      ? await checkRateLimit(
          req,
          'vocab-ip',
          { perMin: 0, perHour: 0, perDay: VOCAB_LIMITS.ip.perDay }, // ログイン時の IP 天井（アカウント量産対策）
          { subject: `user:${uid}`, subjectLimits: VOCAB_LIMITS.user, failClosed: true }
        )
      : await checkRateLimit(req, 'vocab-anon', VOCAB_LIMITS.anon, { failClosed: true });
    if (!rl.ok) {
      if (rl.unavailable) return json({ error: 'unavailable' }, 503);
      // loginHint: 匿名なら「ログインすると枠が増える」。ただし Supabase Auth 不調で匿名に落ちた場合は誤案内になるので出さない。
      return json(
        {
          error: 'rate_limited',
          scope: uid ? rl.scope : 'anon',
          window: rl.window,
          resetAtUtc: rl.resetAtUtc,
          limit: rl.limit,
          anonDayLimit: VOCAB_LIMITS.anon.perDay,
          userDayLimit: VOCAB_LIMITS.user.perDay,
          loginHint: !uid && auth.reason !== 'unavailable',
        },
        429
      );
    }
    release = rl.release;
  }

  // ── 8) ロック取得（token 付き・他人のロックを消さない）──
  const token = randomBytes(16).toString('hex');
  //   Upstash 未設定（開発）だけは無ロックで進む。設定済みで SET が失敗した（null）ときは同じ話の同時生成＝
  //   Haiku の二重課金を防ぐため 503 に倒す（fail-open にしない・レビュー指摘）。
  const got = await tryRedis(() => redisSet(lk, token, { nx: true, ex: VOCAB_LOCK_TTL_SEC }), upstashConfigured() ? null : 'OK');
  if (got !== 'OK') {
    await release();
    const held = await tryRedis(() => redisGet(lk), null);
    if (held && held !== token) return json({ busy: true, retryAfterSec: BUSY_RETRY_AFTER_SEC, ttlSec: VOCAB_LOCK_TTL_SEC }, 409);
    return json({ error: 'unavailable' }, 503);
  }

  const t0 = Date.now();
  const who = seed ? 'seed' : uid ? 'user' : 'anon';
  console.info(`[CL:VOCABGEN] start ${epLabel} by=${who} key=${cacheKey}${titleForLog ? ` title_len=${titleForLog.length}` : ''}`);
  try {
    // ── 9) 生成（TMDB 解決 → 字幕 → Haiku → 📍 → 品質/coverage）──
    const r = await generateEpisodeVocab(
      { tmdbId: id, type: n.type, season: n.season, episode: n.episode, vocabCount, deadlineAt: t0 + GENERATE_DEADLINE_MS },
      { log: console }
    );
    if (r.nosub) {
      // 字幕なし。枠は消費する（release しない）＝実在しない話で OS 検索を無制限に回させない。
      await recordFailure(cacheKey, 'nosub');
      return json({ nosub: true });
    }

    // ── 10) 共有キャッシュ書込（await・応答前に完了＝後続の example_ja 後埋めが行に命中する）──
    let contributed = false;
    let reason = r.reason;
    if (r.contributed) {
      try {
        const w = await writeVocabRow({
          tmdbId: id,
          type: n.type,
          season: n.season,
          episode: n.episode,
          displayTitle: r.displayTitle,
          words: r.storeWords,
          subtitleProvider: r.provider,
          model: r.model,
          contributedBy: contributedByOf({ uid, ip: clientIp(req) }),
        });
        contributed = !!w.written || w.skipped === 'exists';
        if (!contributed) reason = `write-${w.skipped || 'skipped'}`;
      } catch (err) {
        console.error('[CL:VOCABGEN] write failed', epLabel, String(err?.message || err));
        contributed = false;
        reason = 'write-failed';
      }
    }
    if (!contributed && (reason === 'gate' || reason === 'coverage')) {
      // 品質/coverage 不通過: 本人には表示するが、同じ失敗を他の人に繰り返させない（A1）。
      // 書込失敗（DB の一時障害・鍵未設定）は共有キャッシュに何も残っていないので否定キャッシュに入れない
      //（入れると DB の一時障害で全員が1時間再生成不能になる・レビュー指摘）。ログのみ。
      await recordFailure(cacheKey, reason);
    }
    console.info(
      `[CL:VOCABGEN] done ${epLabel} ${Date.now() - t0}ms words=${r.wordCount} drama=${r.dramaCount} chunks=${r.chunks} contributed=${contributed} reason=${reason}`
    );
    return json({
      hit: false,
      generated: true,
      words: r.words,
      meta: {
        model: r.model,
        provider: r.provider,
        coverage: [r.coverage?.min ?? null, r.coverage?.max ?? null],
        wordCount: r.wordCount,
        contributed,
        reason,
      },
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      // 上流（Anthropic/OS の不調・タイムアウト）は枠を戻す＝混雑時の再試行で枠を食い潰さない。
      // ただし TMDB の 4xx（存在しない tmdbId・type 違い）はクライアントが任意に起こせるので枠を消費させる
      //（戻すと匿名で TMDB/Upstash/Supabase を無制限に回せる・レビュー指摘）。
      const clientCaused = err.reason === 'tmdb' && Number(err.status) >= 400 && Number(err.status) < 500;
      if (!clientCaused) await release();
      console.warn(`[CL:VOCABGEN] upstream ${epLabel} reason=${err.reason} status=${err.status ?? '-'} ${Date.now() - t0}ms`);
      await recordFailure(cacheKey, err.reason);
      return json({ error: 'upstream', reason: publicReason(err.reason) }, 502);
    }
    await release();
    console.error('[CL:VOCABGEN] internal', epLabel, String(err?.message || err));
    return json({ error: 'internal' }, 500);
  } finally {
    // ── 11) ロック解放（token 一致のときだけ）──
    await tryRedis(() => redisDelIfEquals(lk, token), null);
  }
}
