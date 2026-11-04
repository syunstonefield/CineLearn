// 初回体験の作品のうち、いま出せるもの（2026-11-05・作品・予習部門と合わせた形）。
//   GET /api/trial-catalog → 200 { ok:true, enabled:[tmdbId, …] }（catalog で enabled=true の体験の作品・ID は6作に固定）
//   * 読むだけ・計数しない。Origin/Referer ゲート（A7）＋IP の軽いレート制限（画面を出すたびに1回の想定）。
//   * 不調は 503 { ok:false }。画面は失敗時に全部出す（vocab-generate の cacheOnly が最終的に blocked で止める）。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { checkRateLimit } from '@/lib/ratelimit';
import { readTrialCatalog } from '@/lib/server/trialCatalog';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function GET(req) {
  if (!allowedOrigin(req)) return json({ ok: false, error: 'forbidden' }, 403);
  const rl = await checkRateLimit(req, 'trial-catalog', { perMin: 20, perHour: 120, perDay: 500 });
  if (!rl.ok) return json({ ok: false, error: 'rate_limited' }, 429);
  try {
    const r = await readTrialCatalog();
    return r.ok ? json(r) : json({ ok: false, error: 'unavailable' }, 503);
  } catch {
    return json({ ok: false, error: 'unavailable' }, 503);
  }
}
