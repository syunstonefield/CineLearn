// ベータ運用の日次カウンタの読み出し（lib/server/stats.js）。ヘッダ x-cinelearn-stats が env CL_STATS_SECRET と一致する時のみ。
//   seed/weekly-stats.mjs が叩いて週次の表にする。個人を特定できる値は返さない（利用者はユニーク数のみ）。
//   ★CL_SEED_SECRET は流用しない: contributed_by の HMAC 鍵も兼ねており（vocabCache.js）、差し替えると提供者の
//   同一性が切れる。手元に値が無い（Vercel から取り出せない）ので、集計専用の秘密を別に持つ（2026-10-08）。

export const dynamic = 'force-dynamic';

import { createHash, timingSafeEqual } from 'crypto';
import { readStats } from '@/lib/server/stats';
import { readOsQuotaLast } from '@/lib/server/opensubtitles';
import { OS_DL_DAILY_CAP } from '@/lib/server/constants';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function isStatsRequest(req, env = process.env) {
  const secret = env.CL_STATS_SECRET;
  const given = req.headers.get('x-cinelearn-stats');
  if (typeof secret !== 'string' || !secret || typeof given !== 'string' || !given) return false;
  // 両辺を sha256 で揃えてから定数時間比較（auth.js isSeedRequest と同じ作法）。
  return timingSafeEqual(createHash('sha256').update(secret).digest(), createHash('sha256').update(given).digest());
}

export async function GET(req) {
  if (!isStatsRequest(req)) return json({ error: 'forbidden' }, 403);
  const days = Math.min(120, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 56));
  try {
    const stats = await readStats(days);
    return json({ ...stats, osDailyCap: OS_DL_DAILY_CAP, osQuotaLast: await readOsQuotaLast() });
  } catch (err) {
    return json({ error: 'unavailable', detail: String(err?.message || err).slice(0, 120) }, 503);
  }
}
