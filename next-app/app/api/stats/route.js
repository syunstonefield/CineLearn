// ベータ運用の日次カウンタの読み出し（lib/server/stats.js）。x-cinelearn-seed（CL_SEED_SECRET）一致時のみ。
//   seed/weekly-stats.mjs が叩いて週次の表にする。個人を特定できる値は返さない（利用者はユニーク数のみ）。

export const dynamic = 'force-dynamic';

import { isSeedRequest } from '@/lib/server/auth';
import { readStats } from '@/lib/server/stats';
import { readOsQuotaLast } from '@/lib/server/opensubtitles';
import { OS_DL_DAILY_CAP } from '@/lib/server/constants';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function GET(req) {
  if (!isSeedRequest(req)) return json({ error: 'forbidden' }, 403);
  const days = Math.min(120, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 56));
  try {
    const stats = await readStats(days);
    return json({ ...stats, osDailyCap: OS_DL_DAILY_CAP, osQuotaLast: await readOsQuotaLast() });
  } catch (err) {
    return json({ error: 'unavailable', detail: String(err?.message || err).slice(0, 120) }, 503);
  }
}
