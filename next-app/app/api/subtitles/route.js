// 字幕まわりの公開面（§3・A5・A16）。2026-09-12 に生SRTの配信を廃止した。
//   * action:'probe'    … 字幕の有無だけ返す { found, count, via }（tmdbId 必須・DL しない・raw cache → 否定キャッシュ →
//                         probe キャッシュ 6h → OS 検索）。単語リスト画面の「予習をはじめる」を出すかの判定に使う。
//   * action:'search'   … seed 専用（x-cinelearn-seed 一致）。OS 検索結果 { data:[…] } を返す（本文は含まない）。
//   * action:'download' … seed 専用。生 SRT を text/plain で返す（backfill-timestamps / verify-timestamps /
//                         backfill-raw-cache 用）。seed 以外は 403。日次キャップは seed 用途なので掛けない。
//   旧 'search'/'download' を公開していた経路は、生SRT全文がクライアントの localStorage に載る＝
//   「配らない」方針と矛盾していたため閉じた（pending-fixes 🔴）。旧バンドルには A16 の文言で再読み込みを促す。
// OS の呼び出し本体は lib/server/opensubtitles.js（in-process）。残枠ログ [CL:OS] もそこで出る。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { isSeedRequest } from '@/lib/server/auth';
import { checkRateLimit } from '@/lib/ratelimit';
import { osSearch, osDownload, probeEpisode } from '@/lib/server/opensubtitles';
import { UpstreamError } from '@/lib/server/constants';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 旧クライアント（キャッシュされた SPA バンドル）向け: 再読み込みで直ることが伝わる文言（A16）。
const unsupported = () =>
  json({ error: { message: 'アプリを再読み込みしてください（新しい版があります）' }, code: 'unsupported_mode' }, 400);

const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
// TV の話数の受理範囲（任意の (S,E) 組ごとに OS 検索を発生させない・vocab-generate と同じ）。
const SEASON_MAX = 60;
const EPISODE_MAX = 400;
function episodeOrError(body, type) {
  if (type === 'movie') return { season: 0, episode: 0 };
  const season = posInt(body.season);
  const episode = posInt(body.episode);
  if (!season || !episode) return { error: 'season/episode must be positive integers for tv' };
  if (season > SEASON_MAX || episode > EPISODE_MAX) return { error: 'season/episode out of range' };
  return { season, episode };
}

function upstreamResponse(err) {
  if (err instanceof UpstreamError) {
    if (err.reason === 'misconfigured') return json({ error: 'server_misconfigured' }, 500);
    return json({ error: 'upstream', reason: err.reason }, 502);
  }
  console.error('[CL:SUBTITLES] internal', String(err?.message || err));
  return json({ error: 'internal' }, 500);
}

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const action = body?.action;
  const seed = isSeedRequest(req);

  // ゲート通過後の枠保護：IP 単位 30/分・300/時（Upstash env 未設定なら no-op）。seed は免除。
  if (!seed && !(await checkRateLimit(req, 'subtitles')).ok) return json({ error: 'rate_limited' }, 429);

  if (action === 'probe') {
    const tmdbId = posInt(body.tmdbId);
    if (!tmdbId) return json({ error: 'tmdbId is required' }, 400); // 自由 query の probe は廃止（A5）
    const type = body.type === 'movie' ? 'movie' : 'tv';
    const ep = episodeOrError(body, type);
    if (ep.error) return json({ error: ep.error }, 400);
    try {
      const r = await probeEpisode({ tmdbId, type, season: ep.season, episode: ep.episode });
      return json({ found: r.found, count: r.count, via: r.via });
    } catch (err) {
      return upstreamResponse(err);
    }
  }

  if (action === 'search') {
    if (!seed) return unsupported();
    const tmdbId = posInt(body.tmdbId);
    if (!tmdbId) return json({ error: 'tmdbId is required' }, 400);
    const type = body.type === 'movie' ? 'movie' : 'tv';
    const ep = episodeOrError(body, type);
    if (ep.error) return json({ error: ep.error }, 400);
    try {
      const data = await osSearch({ tmdbId, type, season: ep.season, episode: ep.episode });
      return json({ data: Array.isArray(data) ? data : [] });
    } catch (err) {
      return upstreamResponse(err);
    }
  }

  if (action === 'download') {
    // 生 SRT を返す唯一の門。seed 秘密ヘッダ一致のときだけ（内部運用＝30条の4）。
    if (!seed) return json({ error: 'forbidden' }, 403);
    const fileId = posInt(body.fileId);
    if (!fileId) return json({ error: 'fileId is required' }, 400);
    try {
      const r = await osDownload(fileId, { enforceDailyCap: false });
      return new Response(r.srt, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      return upstreamResponse(err);
    }
  }

  return unsupported();
}
