// ベータの利用データの週次の表（seed/weekly-stats.mjs が使う・2026-10-09）。依存なしの純関数（node のテストから読む）。
//   入力 rows＝/api/stats の usageRows（1人＋端末×1日の行 { day, p, d, L, c, r }）。人の数は p（人の番号）で数える。
//   週＝today（端末の日付・JST）から7日ずつさかのぼる。新しい週が先。

import { parseExitEvent } from './usageEvents.js';

export const PLUS_FEATURES = [
  ['work_review', '作品・話の復習'],
  ['work_all_review', '作品まとめ復習'],
  ['work_quiz', '作品・話のクイズ'],
  ['journey_tab', 'あゆみ(タブ)'],
  ['journey_grass', 'あゆみ(学習した日から)'],
  ['trend_seen', '週ごとの推移'],
];
const PLUS_KEYS = PLUS_FEATURES.map(([k]) => k);
export const FUNNEL = [
  ['list_open', '①リストを開いた'],
  ['walk_start', '③カードを始めた'],
  ['walk_core', '④重要語を見終えた'],
  ['walk_rest', '⑤残りも見た'],
  ['walk_done', '⑥予習完了'],
];
// 初めて復習する語の無料の上限（lib/storage.js NEW_WORDS_DAILY_FREE と同値。判断の目安の表示用）
export const NEW_WORDS_FREE = 20;

const addDays = (day, n) => {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export function weekWindows(today, weeks) {
  return Array.from({ length: weeks }, (_, w) => ({ from: addDays(today, -7 * w - 6), to: addDays(today, -7 * w) }));
}
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '-');
const bucket = (n, edges) => {
  // edges: [[上限, ラベル], …]（上限以下に入る・最後は Infinity）
  for (const [max, label] of edges) if (n <= max) return label;
  return edges[edges.length - 1][1];
};
const NEW_EDGES = [
  [0, '0'],
  [10, '1-10'],
  [20, '11-20'],
  [30, '21-30'],
  [50, '31-50'],
  [Infinity, '51-'],
];
const LEFT_EDGES = [
  [0, '0'],
  [20, '1-20'],
  [50, '21-50'],
  [100, '51-100'],
  [Infinity, '101-'],
];

function weekRows(rows, win) {
  return rows.filter((r) => r.day >= win.from && r.day <= win.to);
}

export function buildUsageReport(rows, { today, weeks = 8 } = {}) {
  const wins = weekWindows(today, weeks);
  const plus = [];
  const funnel = [];
  const review = [];
  for (const win of wins) {
    const rs = weekRows(rows, win);
    const label = `${win.from.slice(5)}〜${win.to.slice(5)}`;
    const people = new Set(rs.map((r) => r.p));
    const loggedIn = new Set(rs.filter((r) => r.L).map((r) => r.p));
    const usersOf = (k) => new Set(rs.filter((r) => (r.c[k] || 0) > 0).map((r) => r.p));
    const timesOf = (k) => rs.reduce((n, r) => n + (r.c[k] || 0), 0);

    // ② 利用者とプラスの機能（人数（全体の%）／回数）
    const anyPlus = new Set(rs.filter((r) => PLUS_KEYS.some((k) => (r.c[k] || 0) > 0)).map((r) => r.p));
    const row = { 週: label, 開いた人: people.size, ログイン: loggedIn.size, 'プラス機能を1つでも': `${anyPlus.size} (${pct(anyPlus.size, people.size)})` };
    for (const [k, name] of PLUS_FEATURES) row[name] = `${usersOf(k).size}人 ${pct(usersOf(k).size, people.size)} / ${timesOf(k)}回`;
    plus.push(row);

    // ③ 予習の流れ（人数（①に対する%）／回数）
    const opened = usersOf('list_open').size;
    const f = { 週: label };
    for (const [k, name] of FUNNEL) {
      const u = usersOf(k).size;
      f[name] = k === 'list_open' ? `${u}人 / ${timesOf(k)}回` : `${u}人 ${pct(u, opened)} / ${timesOf(k)}回`;
    }
    funnel.push(f);

    // ④ 毎日の復習の語数（1行＝1人＋端末×1日。復習した日＝初めて＋継続が1語以上）
    const days = rs.filter((r) => r.r && r.r.n + r.r.c > 0);
    const rv = { 週: label, 復習した人: new Set(days.map((r) => r.p)).size, 延べ日数: days.length };
    for (const [, l] of NEW_EDGES) rv[`初めて${l}語`] = 0;
    for (const r of days) rv[`初めて${bucket(r.r.n, NEW_EDGES)}語`]++;
    const overDays = new Map();
    for (const r of days) if (r.r.n > NEW_WORDS_FREE) overDays.set(r.p, (overDays.get(r.p) || 0) + 1);
    const ov = [...overDays.values()];
    rv[`${NEW_WORDS_FREE}語超 1日`] = ov.filter((n) => n === 1).length;
    rv[`${NEW_WORDS_FREE}語超 2-3日`] = ov.filter((n) => n >= 2 && n <= 3).length;
    rv[`${NEW_WORDS_FREE}語超 4日+`] = ov.filter((n) => n >= 4).length;
    const lefts = rs.filter((r) => r.r).map((r) => r.r.l);
    rv['残り(中央値)'] = lefts.length ? lefts.sort((a, b) => a - b)[Math.floor(lefts.length / 2)] : '-';
    for (const [, l] of LEFT_EDGES) rv[`残り${l}`] = 0;
    for (const n of lefts) rv[`残り${bucket(n, LEFT_EDGES)}`]++;
    review.push(rv);
  }

  // ③の下: 抜けた場所（表示した全期間の合計）。段階×（何割まで／抜け方）
  const all = rows.filter((r) => r.day >= wins[wins.length - 1].from && r.day <= wins[0].to);
  const STAGE = { list: '①一覧', core: '④までのカード', rest: '⑤残りのカード' };
  const HOW = { walk: 'カードへ', x: '✕', later: 'あとで', nav: '別の画面', close: '閉じた' };
  const DEC = [
    [1, '0-1割'],
    [4, '2-4割'],
    [7, '5-7割'],
    [9, '8-9割'],
    [10, '最後まで'],
  ];
  const exits = Object.keys(STAGE).map((st) => {
    const o = { 段階: STAGE[st], 計: 0 };
    for (const [, l] of DEC) o[l] = 0;
    for (const h of Object.values(HOW)) o[h] = 0;
    return o;
  });
  for (const r of all) {
    for (const [k, n] of Object.entries(r.c)) {
      const e = parseExitEvent(k);
      if (!e) continue;
      const o = exits[Object.keys(STAGE).indexOf(e.stage)];
      o.計 += n;
      o[bucket(e.decile, DEC)] += n;
      o[HOW[e.how]] += n;
    }
  }
  return { plus, funnel, exits, review };
}

// ⑤ 月の新規生成（genMonth＝[{ month, counts:[1人ごとの話数] }]）
export function genMonthTable(genMonth, { free = 5, plus = 30 } = {}) {
  const EDGES = [
    [1, '1話'],
    [3, '2-3話'],
    [5, '4-5話'],
    [10, '6-10話'],
    [30, '11-30話'],
    [Infinity, '31話-'],
  ];
  return (genMonth || []).map(({ month, counts }) => {
    const cs = (counts || []).filter((n) => n > 0);
    const o = { 月: `${month.slice(0, 4)}-${month.slice(4)}`, 生成した人: cs.length };
    for (const [, l] of EDGES) o[l] = 0;
    for (const n of cs) o[bucket(n, EDGES)]++;
    o[`${free}話超`] = pct(cs.filter((n) => n > free).length, cs.length);
    o[`${plus}話超`] = pct(cs.filter((n) => n > plus).length, cs.length);
    o.最多 = cs.length ? Math.max(...cs) : 0;
    return o;
  });
}

// 判断の目安（直近の週＝表の先頭）
export function usageHints(report, rows, { today } = {}) {
  const [w0] = weekWindows(today, 1);
  const rs = weekRows(rows, w0);
  const people = new Set(rs.map((r) => r.p)).size;
  const anyPlus = new Set(rs.filter((r) => PLUS_KEYS.some((k) => (r.c[k] || 0) > 0)).map((r) => r.p)).size;
  const over = new Map();
  for (const r of rs) if (r.r && r.r.n > NEW_WORDS_FREE) over.set(r.p, (over.get(r.p) || 0) + 1);
  const heavy = [...over.values()].filter((n) => n >= 4).length;
  const reviewers = new Set(rs.filter((r) => r.r && r.r.n + r.r.c > 0).map((r) => r.p)).size;
  return [
    `直近の週: プラスの機能を1つでも使った人 ${anyPlus}/${people}（${pct(anyPlus, people)}）＝払う割合の上限の目安`,
    `直近の週: 初めて復習する語が${NEW_WORDS_FREE}語を超えた日が4日以上ある人 ${heavy}/${reviewers}（${pct(heavy, reviewers)}）＝正式版で上限をよく感じる人`,
  ];
}

// --csv 用（1行＝1人＋端末×1日）。項目は列に展開（無い項目は 0）。
export function usageCsv(rows) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.c)))].sort();
  const head = ['day', 'person', 'device', 'logged_in', 'new_words', 'continued_words', 'due_left', ...keys];
  const lines = [head.join(',')];
  for (const r of [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) {
    lines.push([r.day, r.p, r.d, r.L, r.r?.n ?? '', r.r?.c ?? '', r.r?.l ?? '', ...keys.map((k) => r.c[k] || 0)].join(','));
  }
  return lines.join('\n') + '\n';
}
