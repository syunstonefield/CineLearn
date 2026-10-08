// 有料判定（isPro）の土台（design-paid-features-2026-10-08「実装メモ 0. 土台: isPro」「ベータ方針」）。
//   * サーバー側フラグ env CL_PLAN_MODE: 未設定 or 'beta' ＝ベータ中＝全員 isPro:true（profiles.plan は読まない）。
//     'release' ＝正式版＝ログインユーザーの profiles.plan を service_role で読む。正式版はこの env を切り替えるだけ。
//   * profiles は「アカウント内のプロフィール」単位の行（id='p_xxxx'）。課金はアカウント単位なので、
//     同じ user_id の行に 1 つでも plan='plus' があれば plus とする。
//   * 判定できない時（未ログイン・トークン失効・DB 不調）は free 側に倒す（権限を勝手に付与しない）。
//     ok:false を返し、クライアントは前回の値を保ったままにする（一時不調で表示が揺れないように）。
//   * plan 列はクライアントから書けない（supabase_profiles_plan.sql の列レベル GRANT）。書くのは将来の決済処理（service_role）のみ。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from './constants.js';
import { resolveUserId } from './auth.js';

export const PLANS = ['free', 'plus'];

// 'beta' | 'release'。不明な値は beta（＝今の約束「ベータ中は全員使える」を壊さない側）。
export function planMode(env = process.env) {
  return env.CL_PLAN_MODE === 'release' ? 'release' : 'beta';
}

// profiles 行の配列 → 'free' | 'plus'
export function planFromRows(rows) {
  return Array.isArray(rows) && rows.some((r) => r?.plan === 'plus') ? 'plus' : 'free';
}

// 戻り値: { ok, beta, isPro, plan: 'free'|'plus'|null }
//   beta 中は plan:null（まだ誰も契約していない＝列の値に意味がない）。
export async function resolvePlan(req, { env = process.env, fetchImpl = fetch, serviceKey = SUPABASE_SERVICE_KEY } = {}) {
  if (planMode(env) === 'beta') return { ok: true, beta: true, isPro: true, plan: null };

  const free = (ok) => ({ ok, beta: false, isPro: false, plan: 'free' });
  const { uid, reason } = await resolveUserId(req, { fetchImpl });
  if (!uid) return free(reason === 'none' || reason === 'invalid');
  if (!serviceKey) return free(false);
  try {
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=plan`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return free(false);
    const plan = planFromRows(await res.json());
    return { ok: true, beta: false, isPro: plan === 'plus', plan };
  } catch {
    return free(false);
  }
}
