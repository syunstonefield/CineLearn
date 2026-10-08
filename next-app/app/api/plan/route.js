// 有料判定（isPro）を返す（lib/server/plan.js）。クライアントは lib/plan.js の usePlan() から呼ぶ。
//   ベータ中（env CL_PLAN_MODE 未設定）は Supabase も Auth も叩かず即 { beta:true, isPro:true }。
//   応答は利用者ごとに変わるので no-store。

export const dynamic = 'force-dynamic';

import { resolvePlan } from '@/lib/server/plan';

export async function GET(req) {
  const r = await resolvePlan(req);
  return new Response(JSON.stringify(r), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
