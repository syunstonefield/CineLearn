// ベータ運用の週次レポート（2026-10-08）。OS 商用契約の判断材料を1枚で見る。
//   node --env-file=seed/.env seed/weekly-stats.mjs [週数=8]
//   本番 /api/stats（x-cinelearn-stats＝seed/.env の CL_STATS_SECRET 必須）を読み、直近の週ごとに
//   利用者（ユニーク）・単語リストの命中率・新規生成・OS DL 消費（日次枠に対するピーク）を表にする。
//   数え始めは 2026-10-08 のデプロイ以降（それ以前の日は 0）。
//   2026-10-09: ベータの利用データ（docs/design-usage-stats-2026-10-09.md）の表②〜⑤を追加。
//     ② 利用者とプラスの機能 ③ 予習の流れ（＋抜けた場所） ④ 毎日の復習の語数 ⑤ 月の新規生成
//     --csv[=パス] で 1人＋端末×1日の生データを書き出す（既定 ~/cinelearn-usage-<日付>.csv）。
//     ★CSV はリポジトリに置かない・共有しない・暗号化ディスク（FileVault）上だけ・120日以内に消す。

import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { API_BASE, SEED_HOST } from './lib/osdl.mjs';
import { buildUsageReport, genMonthTable, usageHints, usageCsv } from '../next-app/lib/usageReport.js';

const args = process.argv.slice(2);
const weeks = Math.min(17, Math.max(1, Number(args.find((a) => /^\d+$/.test(a))) || 8));
const csvArg = args.find((a) => a === '--csv' || a.startsWith('--csv='));
if (!API_BASE) {
  console.error('CINELEARN_API_BASE 未設定（seed/.env を --env-file で渡す）');
  process.exit(1);
}
const secret = process.env.CL_STATS_SECRET;
if (!secret) {
  console.error('CL_STATS_SECRET 未設定（seed/.env に置く）');
  process.exit(1);
}
if (new URL(API_BASE).hostname !== SEED_HOST) {
  console.error(`CINELEARN_API_BASE のホストが ${SEED_HOST} ではない → 秘密を別ホストへ送らない`);
  process.exit(1);
}

const res = await fetch(`${API_BASE}/api/stats?days=${weeks * 7}`, { headers: { 'x-cinelearn-stats': secret } });
if (!res.ok) {
  console.error(`/api/stats ${res.status}`, (await res.text()).slice(0, 200));
  process.exit(1);
}
const { daily, weeklyUsers, osDailyCap, osQuotaLast, usageRows = [], genMonth = [] } = await res.json();

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

// ── ベータの利用データ（2026-10-09〜）──
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // 端末の日付（JST）に合わせる
const rep = buildUsageReport(usageRows, { today, weeks });
console.log('\n② 利用者とプラスの機能（人数 全体の% / 回数）');
console.table(rep.plus);
console.log('\n③ 予習の流れ（人数 ①に対する% / 回数）');
console.table(rep.funnel);
console.log(`③の下: 抜けた場所（直近${weeks}週の合計・回数）`);
console.table(rep.exits);
console.log('\n④ 毎日の復習の語数（1人＋端末×1日の延べ日数。「○語超」は人数・端末ごとの数）');
console.table(rep.review);
console.log('\n⑤ 月の新規生成（ログイン利用者・共有済みの話は数えない）');
console.table(genMonthTable(genMonth));
for (const line of usageHints(rep, usageRows, { today })) console.log(`判断の目安: ${line}`);
console.log(`利用データの行数: ${usageRows.length}（数え始めは利用データのデプロイ以降）`);

if (csvArg) {
  const path = csvArg.includes('=') ? resolve(csvArg.split('=')[1]) : join(homedir(), `cinelearn-usage-${today}.csv`);
  if (path.startsWith(resolve(new URL('..', import.meta.url).pathname))) {
    console.error('CSV をリポジトリの中には書かない（--csv=~/… など外を指定）');
    process.exit(1);
  }
  writeFileSync(path, usageCsv(usageRows), { mode: 0o600 });
  console.log(`CSV: ${path}（共有しない・120日以内に消す）`);
}
