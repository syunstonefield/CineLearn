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
  ['journey_cefr_seen', '段階ごとの覚えた語'],
];
const PLUS_KEYS = PLUS_FEATURES.map(([k]) => k);
export const FUNNEL = [
  ['list_open', '①リストを開いた'],
  ['walk_start', '③カードを始めた'],
  ['walk_core', '④重要語を見終えた'],
  ['walk_rest', '⑤残りも見た'],
  ['walk_done', '⑥予習完了'],
];
// 初回アンケート（components/Onboarding.js・2026-11-01〜）。表示された人数を1問目に対する%で。
export const ONBOARDING = [
  ['ob_q1', '1問目 レベル'],
  ['ob_q2', '2問目 サービス'],
  ['ob_q3', '3問目 ジャンル'],
  ['ob_q4', '4問目 目的'],
  ['ob_q5', '5問目 知った所'],
  ['ob_plan', 'プラン提示'],
  ['ob_done', '完了'],
];
// 新規の人がどこで離れるか（2026-11-04〜）。⑦は「初めて開いた週」の人だけ、⑧は全員。
export const NEW_USER_STEPS = [
  ['auth_shown', 'ログイン画面'],
  ['auth_signup', '新規登録'],
  ['auth_login', 'ログイン'],
  ['auth_local', 'このデバイスのみ'],
  ['work_select', '作品を選んだ'],
  ['list_open', 'リストを開いた'],
  ['ext_install_open', '拡張から来た'],
  ['ext_first_save', '拡張で初保存'],
];
// ⑨ 初回体験の流れ（2026-11-05〜・名前は作品・予習部門の画面と同じ）。人数は trial_start に対する%。
export const TRIAL_STEPS = [
  ['trial_start', '最初の画面'],
  ['trial_welcome', 'ようこそ'],
  ['trial_level', 'レベル'],
  ['trial_intro', '案内'],
  ['trial_pick', '作品'],
  ['trial_list', '5語'],
  ['trial_walk_done', '予習5枚'],
  ['trial_quiz_done', 'クイズ'],
  ['trial_done', '完了画面'],
  ['trial_signup_click', '登録へ'],
  ['trial_later', 'あとで'],
  ['trial_next', '次の一歩'],
  ['trial_later_band', '次回の帯'],
];

// ⑫ 単語を学ぶの流れ（2026-11-13〜・作品・予習部門の画面）。人数は learn_start に対する%。
//   learn_first は端末ごとに1回の印なので、人ではなく端末の数で出す。
export const LEARN_STEPS = [
  ['learn_done', '最後まで'],
  ['learn_more', '続けた'],
  ['learn_quit', '途中で抜けた'],
];

// ⑪ スライド式チュートリアルの流れ（2026-11-10〜・NEXT_PUBLIC_FIRST_RUN が trial の間は 0）。人数は intro_start に対する%。
export const INTRO_STEPS = [
  ['intro_start', 'ようこそ'],
  ['intro_s2', '2枚目'],
  ['intro_s3', '3枚目'],
  ['intro_s4', '4枚目'],
  ['intro_s5', '5枚目'],
  ['intro_s6', '6枚目'],
  ['intro_skip', 'スキップ'],
  ['intro_guest', '登録せずに開始'],
  ['intro_auth_click', 'ログイン・登録へ'],
  ['intro_level', 'レベル'],
  ['tour_start', '案内の開始'],
  ['tour_skip', '案内をスキップ'],
  ['tour_done', '案内を最後まで'],
  ['tour_add', '案内から作品追加'],
];

// ⑩ 復習の流れ（2026-11-07〜・復習タブのカード）。答えの内訳と1枚の時間は割合で（集計にだけ使う＝法務）。
export const REVIEW_ANSWERS = [
  ['review_ans_fail', '知らなかった'],
  ['review_ans_hard', 'うろ覚え'],
  ['review_ans_easy', '知ってた'],
];
export const REVIEW_TIMES = [
  ['review_t_0_5', '〜5秒'],
  ['review_t_5_10', '5〜10秒'],
  ['review_t_10_20', '10〜20秒'],
  ['review_t_20p', '20秒〜'],
];

// 運営の端末・アカウントを外す（2026-11-07・オーナー依頼）。
//   起点＝印（S）が付いた行の端末と、seed から渡す運営の利用者の番号（excludePersons）。そこから
//   「端末でログインした人 → その人がログインした別の端末 → …」とたどり、つながった端末と人の行を全部外す。
//   端末の番号はログアウトでも変わらない（cl_device_key は消去対象外）ので、印を1回付けるだけで、その端末の過去の行
//   （印を付ける前の日・ゲストの行・テスト用に作ったアカウントの行）もまとめて外れる。
//   devices＝端末の番号の除外リスト（seed/.env CL_STATS_EXCLUDE_DEVICES・印を付けられない使い捨ての確認用ブラウザ・2026-11-08）。
export function staffComponent(rows, { persons = [], devices = [] } = {}) {
  const devs = new Set(devices || []);
  const ppl = new Set(persons || []);
  for (const r of rows || []) {
    if (!r?.S) continue;
    devs.add(r.d);
    if (r.p !== r.d) ppl.add(r.p);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of rows || []) {
      if (!r) continue;
      if (ppl.has(r.p) && !devs.has(r.d)) {
        devs.add(r.d);
        changed = true;
      }
      if (devs.has(r.d) && r.p !== r.d && !ppl.has(r.p)) {
        ppl.add(r.p);
        changed = true;
      }
    }
  }
  return { devices: devs, persons: ppl };
}
export function excludeStaff(rows, { persons = [], devices: seedDevices = [] } = {}) {
  const { devices, persons: ppl } = staffComponent(rows, { persons, devices: seedDevices });
  const kept = [];
  let removed = 0;
  for (const r of rows || []) {
    if (devices.has(r.d) || ppl.has(r.p)) removed++;
    else kept.push(r);
  }
  const seen = new Set((rows || []).map((r) => r?.d));
  return { rows: kept, excluded: { rows: removed, devices: [...devices].filter((d) => seen.has(d)).length, persons: ppl.size } };
}

// ゲスト→登録を同じ人として数える（集計側だけ・2026-11-05）。
//   行の名前は「人の番号.端末の番号」で、端末の番号はゲスト行（人＝端末）にもログイン行にも入っている。
//   同じ端末で後からログインした人の番号が分かれば、その端末のゲスト行をその人に寄せる。
//   * サーバー・アプリ・保存の形は変えない（/api/stats の行をそのまま読み替える）。
//   * 同じ端末に複数のアカウント → 最初に現れた（日付の早い）人に寄せる。
//   * ゲストのまま（ログイン行が無い端末）は寄せない＝「このデバイスのみ」で居続ける人は別の人のまま（正しい）。
//   * ポリシー: 「登録・ログインの前後の利用を一人分として集計するため、両方の番号を結び付けることがあります。」
export function joinGuestRows(rows) {
  const owner = new Map(); // 端末の番号 → その端末で最初にログインした人の番号
  for (const r of [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) {
    if (r.p !== r.d && !owner.has(r.d)) owner.set(r.d, r.p);
  }
  return rows.map((r) => (r.p === r.d && owner.has(r.d) ? { ...r, p: owner.get(r.d), joined: true } : r));
}

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

export function buildUsageReport(rawRows, { today, weeks = 8, excludePersons = [], excludeDevices = [], includeStaff = false } = {}) {
  const staff = includeStaff ? { rows: rawRows, excluded: null } : excludeStaff(rawRows, { persons: excludePersons, devices: excludeDevices });
  const rows = joinGuestRows(staff.rows); // ゲスト→登録を同じ人に（⑦の「2人に数える」誤差の解消）
  const wins = weekWindows(today, weeks);
  const plus = [];
  const funnel = [];
  const review = [];
  const onboarding = [];
  const entry = [];
  const trial = [];
  const intro = [];
  const reviewFlow = [];
  const learn = [];
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

    // ⑥ 初回アンケートの進み具合（人数（1問目に対する%）／スキップした人数）
    const q1 = usersOf('ob_q1').size;
    const ob = { 週: label };
    for (const [k, name] of ONBOARDING) {
      const u = usersOf(k).size;
      ob[name] = k === 'ob_q1' ? `${u}人` : `${u}人 ${pct(u, q1)}`;
    }
    for (let q = 2; q <= 5; q++) ob[`スキップ${q}`] = usersOf(`ob_skip_q${q}`).size;
    onboarding.push(ob);

    // ⑧ 入口とログイン画面（全員・人数（開いた人の%）／回数）
    const en = { 週: label, 開いた人: people.size };
    for (const [k, name] of NEW_USER_STEPS) en[name] = `${usersOf(k).size}人 ${pct(usersOf(k).size, people.size)} / ${timesOf(k)}回`;
    entry.push(en);

    // ⑨ 初回体験の流れ（人数（最初の画面に対する%）／回数）
    const t0 = usersOf('trial_start').size;
    const tr = { 週: label };
    for (const [k, name] of TRIAL_STEPS) {
      const u = usersOf(k).size;
      tr[name] = k === 'trial_start' ? `${u}人 / ${timesOf(k)}回` : `${u}人 ${pct(u, t0)} / ${timesOf(k)}回`;
    }
    trial.push(tr);

    // ⑪ スライド式チュートリアルの流れ（人数（ようこそに対する%）／回数）
    const i0 = usersOf('intro_start').size;
    const it = { 週: label };
    for (const [k, name] of INTRO_STEPS) {
      const u = usersOf(k).size;
      it[name] = k === 'intro_start' ? `${u}人 / ${timesOf(k)}回` : `${u}人 ${pct(u, i0)} / ${timesOf(k)}回`;
    }
    intro.push(it);

    // ⑩ 復習の流れ（始めた回数に対する完了の%・抜けた回数／答えの内訳の%／1枚の時間の%）
    const started = timesOf('review_start');
    const exitsN = rs.reduce((n, r) => n + Object.entries(r.c).reduce((m, [k, v]) => (parseExitEvent(k)?.stage === 'review' ? m + v : m), 0), 0);
    const rf = { 週: label, 始めた人: usersOf('review_start').size, 始めた回: started, 終えた回: `${timesOf('review_done')} ${pct(timesOf('review_done'), started)}`, 途中で抜けた回: exitsN };
    const ans = REVIEW_ANSWERS.reduce((n, [k]) => n + timesOf(k), 0);
    for (const [k, name] of REVIEW_ANSWERS) rf[name] = pct(timesOf(k), ans);
    const tms = REVIEW_TIMES.reduce((n, [k]) => n + timesOf(k), 0);
    for (const [k, name] of REVIEW_TIMES) rf[name] = pct(timesOf(k), tms);
    reviewFlow.push(rf);

    // ⑫ 単語を学ぶの流れ（人数（始めた人に対する%）／回数・作品を選んだ人に対する始めた人の割合・初めての5枚は端末）
    const l0 = usersOf('learn_start').size;
    const picked = usersOf('work_select').size;
    const lf = { 週: label, 始めた: `${l0}人 / ${timesOf('learn_start')}回`, '作品を選んだ人のうち': pct(l0, picked) };
    for (const [k, name] of LEARN_STEPS) lf[name] = `${usersOf(k).size}人 ${pct(usersOf(k).size, l0)} / ${timesOf(k)}回`;
    lf['初めての5枚（端末）'] = new Set(rs.filter((r) => (r.c.learn_first || 0) > 0).map((r) => r.d)).size;
    lf['ホームの「学ぶ」'] = `${usersOf('home_learn').size}人 / ${timesOf('home_learn')}回`;
    lf['ホームの「クイズ」'] = `${usersOf('home_quiz').size}人 / ${timesOf('home_quiz')}回`;
    learn.push(lf);
  }

  // ③の下: 抜けた場所（表示した全期間の合計）。段階×（何割まで／抜け方）
  const all = rows.filter((r) => r.day >= wins[wins.length - 1].from && r.day <= wins[0].to);
  const STAGE = { list: '①一覧', core: '④までのカード', rest: '⑤残りのカード', review: '⑩復習のカード' };
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
  const joined = rows.filter((r) => r.joined).length;
  return { plus, funnel, exits, review, onboarding, entry, trial, intro, reviewFlow, learn, newUsers: buildNewUsers(rows, wins, today), joinedRows: joined, staffExcluded: staff.excluded };
}

// ⑦ 新規の人（初めて開いた週ごと）。rows の中で最初に現れた日＝初めて開いた日。
//   ★rows は表の期間より1週前から渡す（seed/weekly-stats.mjs）＝表の一番古い週の人が「前の週から使っていた人」
//     でないことを確かめるため（それより前は見えない＝120日より前から使っていた人は新規に混ざり得る）。
//   ★「このデバイスのみ」で始めて後日ログインした人は、同じ端末なら joinGuestRows で同じ人に寄せる（2026-11-05〜）。
//     別の端末でログインした場合は寄せられない（別の新規の人として数える）。
//   各段階は「その人がいつかやったか」（初めての週の中に限らない）。翌日再訪＝初めての日の翌日に行がある、
//   7日内再訪＝翌日〜7日後のどこかに行がある。まだ日が来ていない週は（集計中）。
export function buildNewUsers(rows, wins, today) {
  const first = new Map(); // p → 初めての日
  const days = new Map(); // p → Set(日)
  const did = new Map(); // p → Set(項目)
  for (const r of rows) {
    if (!first.has(r.p) || r.day < first.get(r.p)) first.set(r.p, r.day);
    if (!days.has(r.p)) days.set(r.p, new Set());
    days.get(r.p).add(r.day);
    if (!did.has(r.p)) did.set(r.p, new Set());
    for (const [k, n] of Object.entries(r.c)) if (n > 0) did.get(r.p).add(k);
  }
  return wins.map((win) => {
    const label = `${win.from.slice(5)}〜${win.to.slice(5)}`;
    const ps = [...first.entries()].filter(([, d]) => d >= win.from && d <= win.to).map(([p]) => p);
    const n = ps.length;
    const o = { 週: label, 新規の人: n };
    for (const [k, name] of NEW_USER_STEPS) {
      const u = ps.filter((p) => did.get(p).has(k)).length;
      o[name] = `${u} ${pct(u, n)}`;
    }
    const back = (p, from, to) => {
      const f = first.get(p);
      const ds = days.get(p);
      for (let i = from; i <= to; i++) if (ds.has(addDays(f, i))) return true;
      return false;
    };
    const d1 = ps.filter((p) => back(p, 1, 1)).length;
    const d7 = ps.filter((p) => back(p, 1, 7)).length;
    o['翌日再訪'] = addDays(win.to, 1) <= today ? `${d1} ${pct(d1, n)}` : `${d1}（集計中）`;
    o['7日内再訪'] = addDays(win.to, 7) <= today ? `${d7} ${pct(d7, n)}` : `${d7}（集計中）`;
    return o;
  });
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
export function usageHints(report, rawRows, { today, excludePersons = [], excludeDevices = [], includeStaff = false } = {}) {
  const rows = joinGuestRows(includeStaff ? rawRows : excludeStaff(rawRows, { persons: excludePersons, devices: excludeDevices }).rows);
  const [w0] = weekWindows(today, 1);
  const rs = weekRows(rows, w0);
  const people = new Set(rs.map((r) => r.p)).size;
  const anyPlus = new Set(rs.filter((r) => PLUS_KEYS.some((k) => (r.c[k] || 0) > 0)).map((r) => r.p)).size;
  const over = new Map();
  for (const r of rs) if (r.r && r.r.n > NEW_WORDS_FREE) over.set(r.p, (over.get(r.p) || 0) + 1);
  const heavy = [...over.values()].filter((n) => n >= 4).length;
  const reviewers = new Set(rs.filter((r) => r.r && r.r.n + r.r.c > 0).map((r) => r.p)).size;
  const nu = report.newUsers?.[0];
  const pick = (name) => Number(String(nu?.[name] ?? '0').split(' ')[0]) || 0;
  const n = nu?.新規の人 || 0;
  const lines = [
    `直近の週: プラスの機能を1つでも使った人 ${anyPlus}/${people}（${pct(anyPlus, people)}）＝払う割合の上限の目安`,
    `直近の週: 初めて復習する語が${NEW_WORDS_FREE}語を超えた日が4日以上ある人 ${heavy}/${reviewers}（${pct(heavy, reviewers)}）＝正式版で上限をよく感じる人`,
  ];
  if (nu) {
    lines.push(
      `直近の週に初めて開いた人 ${n}: ログイン画面を見た ${pick('ログイン画面')}・新規登録 ${pick('新規登録')}・このデバイスのみ ${pick('このデバイスのみ')}・作品を選んだ ${pick('作品を選んだ')}・拡張で初保存 ${pick('拡張で初保存')}（翌日・7日内の再訪は⑦）`
    );
  }
  const tw = report.trial?.[0];
  if (tw) {
    const num = (name) => Number(String(tw[name] ?? '0').split('人')[0]) || 0;
    lines.push(
      `直近の週の初回体験: 最初の画面 ${num('最初の画面')}人 → 作品 ${num('作品')} → 予習5枚 ${num('予習5枚')} → 完了画面 ${num('完了画面')} → 登録へ ${num('登録へ')}／あとで ${num('あとで')}`
    );
  }
  const iw = report.intro?.[0];
  if (iw) {
    const num = (name) => Number(String(iw[name] ?? '0').split('人')[0]) || 0;
    if (num('ようこそ'))
      lines.push(
        `直近の週のスライド式: ようこそ ${num('ようこそ')}人 → 6枚目 ${num('6枚目')} → レベル ${num('レベル')} → 案内を最後まで ${num('案内を最後まで')}（案内から作品追加 ${num('案内から作品追加')}）`
      );
  }
  if (report.staffExcluded?.rows) {
    const x = report.staffExcluded;
    lines.push(`運営の端末・アカウントを外した: 端末 ${x.devices}・人 ${x.persons}・行 ${x.rows}（--include-staff で含める）`);
  }
  if (report.joinedRows) lines.push(`ゲスト→登録を同じ人に寄せた行: ${report.joinedRows}（同じ端末でログインした人のゲスト時代の行）`);
  return lines;
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
