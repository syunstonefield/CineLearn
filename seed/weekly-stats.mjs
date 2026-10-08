// ベータ運用の週次レポート（2026-10-08）。OS 商用契約の判断材料を1枚で見る。
//   node --env-file=seed/.env seed/weekly-stats.mjs [週数=8]
//   本番 /api/stats（x-cinelearn-seed 必須）を読み、直近の週ごとに
//   利用者（ユニーク）・単語リストの命中率・新規生成・OS DL 消費（日次枠に対するピーク）を表にする。
//   数え始めは 2026-10-08 のデプロイ以降（それ以前の日は 0）。

import { API_BASE, seedHeaders, seedSecretApplies, warnIfSeedHeaderMissing } from './lib/osdl.mjs';

const weeks = Math.min(17, Math.max(1, Number(process.argv[2]) || 8));
if (!API_BASE) {
  console.error('CINELEARN_API_BASE 未設定（seed/.env を --env-file で渡す）');
  process.exit(1);
}
warnIfSeedHeaderMissing();
if (!seedSecretApplies()) process.exit(1);

const res = await fetch(`${API_BASE}/api/stats?days=${weeks * 7}`, { headers: seedHeaders() });
if (!res.ok) {
  console.error(`/api/stats ${res.status}`, (await res.text()).slice(0, 200));
  process.exit(1);
}
const { daily, weeklyUsers, osDailyCap, osQuotaLast } = await res.json();

const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '-');
const rows = [];
for (let w = 0; w < weeks; w++) {
  const ds = daily.slice(w * 7, w * 7 + 7);
  if (!ds.length) break;
  const sum = (k) => ds.reduce((n, d) => n + (d[k] || 0), 0);
  const hit = sum('vocab_hit');
  const miss = sum('vocab_miss');
  const peakDl = Math.max(0, ...ds.map((d) => d.os_dl || 0));
  rows.push({
    週: `${ds[ds.length - 1].day}〜${ds[0].day}`,
    利用者: weeklyUsers[w]?.users ?? 0,
    リスト表示: hit + miss,
    命中率: pct(hit, hit + miss),
    新規生成: sum('gen_ok'),
    共有されず: sum('gen_uncontrib'),
    字幕なし: sum('gen_nosub'),
    失敗: sum('gen_fail'),
    上限到達: sum('gen_rate_limited'),
    'OS DL計': sum('os_dl'),
    'OS DLピーク/日': `${peakDl}/${osDailyCap}`,
    '★OS枠切れ': sum('gen_os_quota'),
  });
}
console.log(`CineLearn ベータ週次（新しい週が上）  ${new Date().toISOString().slice(0, 10)}`);
console.table(rows);
if (osQuotaLast) {
  console.log(`OS 直近の残枠: remaining=${osQuotaLast.remaining ?? '?'} reset=${osQuotaLast.resetUtc ?? '?'}（${osQuotaLast.at ?? ''}）`);
}
const worst = rows.reduce((m, r) => Math.max(m, Number(String(r['OS DLピーク/日']).split('/')[0]) || 0), 0);
console.log(
  `判断の目安: OS DL ピークが日次枠の 50%（${Math.round(osDailyCap / 2)}）を超える週が出る or「★OS枠切れ」が1件でも出たら、OS 商用契約の価格問い合わせを出す。現在のピーク=${worst}`
);
