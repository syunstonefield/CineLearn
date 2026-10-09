// ベータの利用データの受け口（2026-10-09・docs/design-usage-stats-2026-10-09.md）。
//   POST /api/usage  { day, device, c:{項目:回数}, r:{n,c,l} }＝アプリ（lib/usage.js）が「その日の合計」を上書きで送る。
//   * 名前の一覧（lib/usageEvents.js）に無い項目は捨てる・数に上限・端末ごとに1時間30回まで。
//   * IP は保存しない（レート制限のキーも端末の番号だけ）。生の uid・端末キーも保存しない（lib/server/usage.js）。
//   * 失敗しても利用者には関係ない＝常に 204 寄り（Upstash 未設定・不調は黙って捨てる）。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { resolveUserId } from '@/lib/server/auth';
import { checkRateLimit } from '@/lib/ratelimit';
import { upstashConfigured } from '@/lib/server/upstash';
import { sanitizeUsage } from '@/lib/usageEvents';
import { usageDayAllowed, usageIds, writeUsage } from '@/lib/server/usage';

const empty = (status = 204) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req) {
  if (!allowedOrigin(req)) return empty(403);
  let body;
  try {
    const text = await req.text();
    if (text.length > 8000) return empty(413);
    body = JSON.parse(text);
  } catch {
    return empty(400);
  }
  const u = sanitizeUsage(body);
  if (!u || !usageDayAllowed(u.day)) return empty(400);
  if (!upstashConfigured()) return empty();
  const { device } = usageIds({ device: u.device });
  const rl = await checkRateLimit(req, 'usage', {}, { ipLimitsOff: true, subject: `dev:${device}`, subjectLimits: { perHour: 30, perDay: 200 } });
  if (!rl.ok) return empty(429);
  const { uid } = await resolveUserId(req);
  try {
    await writeUsage(u, { uid });
  } catch (err) {
    console.warn('[CL:USAGE] write failed', String(err?.message || err).slice(0, 80));
  }
  return empty();
}
