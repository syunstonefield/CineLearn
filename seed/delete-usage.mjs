// 利用データの削除依頼に応じる（2026-10-09・法35条・docs/design-usage-stats-2026-10-09.md）。
//   node --env-file=seed/.env seed/delete-usage.mjs <利用者ID（Supabase の UUID）>
//   本番 /api/stats の DELETE（x-cinelearn-stats＝CL_STATS_SECRET）で、その利用者の統計の行（直近121日）と
//   月の生成数（今月・先月）を消す。番号への変換は本番のサーバーでしかできない（秘密の値が手元に無い）。
//   ※未ログインの端末の行は利用者 ID とつながらないので消せない（120日で自動で消える）。

import { API_BASE, SEED_HOST } from './lib/osdl.mjs';

const uid = String(process.argv[2] || '').trim();
if (!/^[0-9a-f-]{36}$/i.test(uid)) {
  console.error('使い方: node --env-file=seed/.env seed/delete-usage.mjs <利用者ID（UUID）>');
  process.exit(1);
}
const secret = process.env.CL_STATS_SECRET;
if (!API_BASE || !secret) {
  console.error('CINELEARN_API_BASE / CL_STATS_SECRET 未設定（seed/.env を --env-file で渡す）');
  process.exit(1);
}
if (new URL(API_BASE).hostname !== SEED_HOST) {
  console.error(`CINELEARN_API_BASE のホストが ${SEED_HOST} ではない → 秘密を別ホストへ送らない`);
  process.exit(1);
}
const res = await fetch(`${API_BASE}/api/stats`, {
  method: 'DELETE',
  headers: { 'x-cinelearn-stats': secret, 'Content-Type': 'application/json' },
  body: JSON.stringify({ uid }),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
