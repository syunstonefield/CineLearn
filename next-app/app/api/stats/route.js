// ベータ運用の日次カウンタの読み出し（lib/server/stats.js）。ヘッダ x-cinelearn-stats が env CL_STATS_SECRET と一致する時のみ。
//   seed/weekly-stats.mjs が叩いて週次の表にする。個人を特定できる値は返さない（利用者はユニーク数のみ）。
//   利用データ（2026-10-09）: usageRows＝1人1日1行（番号は元に戻せない）・genMonth＝月の新規生成数の分布（人数のみ）。
//   DELETE { uid }＝削除の依頼に応じて、その利用者の統計の行と月の生成数を消す（seed/delete-usage.mjs）。
//   ★CL_SEED_SECRET は流用しない: contributed_by の HMAC 鍵も兼ねており（vocabCache.js）、差し替えると提供者の
//   同一性が切れる。手元に値が無い（Vercel から取り出せない）ので、集計専用の秘密を別に持つ（2026-10-08）。

export const dynamic = 'force-dynamic';

import { createHash, timingSafeEqual } from 'crypto';
import { readStats } from '@/lib/server/stats';
import { readUsageRows, readGenMonthDist, deleteUsageFor } from '@/lib/server/usage';
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
    const [usageRows, genMonth] = await Promise.all([readUsageRows(days), readGenMonthDist(4)]);
    return json({ ...stats, usageRows, genMonth, osDailyCap: OS_DL_DAILY_CAP, osQuotaLast: await readOsQuotaLast() });
  } catch (err) {
    return json({ error: 'unavailable', detail: String(err?.message || err).slice(0, 120) }, 503);
  }
}

export async function DELETE(req) {
  if (!isStatsRequest(req)) return json({ error: 'forbidden' }, 403);
  let uid = '';
  try {
    uid = String((await req.json())?.uid || '').trim();
  } catch {}
  if (!/^[0-9a-f-]{36}$/i.test(uid)) return json({ error: 'uid (UUID) is required' }, 400);
  try {
    return json({ ok: true, ...(await deleteUsageFor(uid)) });
  } catch (err) {
    return json({ error: 'unavailable', detail: String(err?.message || err).slice(0, 120) }, 503);
  }
}
