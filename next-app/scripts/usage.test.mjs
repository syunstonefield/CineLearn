// ベータの利用データ（lib/usageEvents.js・lib/usageReport.js・lib/server/usage.js）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUsage, exitEventName, parseExitEvent, toDecile, isUsageEvent, isExtSavedWord, hasExtSavedWord } from '../lib/usageEvents.js';
import { buildUsageReport, genMonthTable, usageCsv, weekWindows, usageHints, joinGuestRows, staffComponent, excludeStaff } from '../lib/usageReport.js';
import { writeUsage, readUsageRows, usageIds, usageDayAllowed, deleteUsageFor } from '../lib/server/usage.js';
import { genMonthKey } from '../lib/server/constants.js';

const ENV = { UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 't', CL_HASH_PEPPER: 'pep' };

test('項目の名前: 一覧と途中離脱の形だけ通す', () => {
  assert.ok(isUsageEvent('open'));
  assert.ok(isUsageEvent('exit_core_7_later'));
  assert.ok(isUsageEvent('exit_list_10_walk'));
  assert.ok(!isUsageEvent('exit_core_11_x'));
  assert.ok(!isUsageEvent('watch:Friends S1E1'));
  assert.equal(exitEventName('rest', 12.7, 'nav'), 'exit_rest_10_nav');
  assert.deepEqual(parseExitEvent('exit_list_3_close'), { stage: 'list', decile: 3, how: 'close' });
  assert.equal(toDecile(15, 15), 10);
  assert.equal(toDecile(7, 15), 4);
  assert.equal(toDecile(1, 0), 0);
});

test('送られてきた本文の検査: 知らない項目・負の数・大きすぎる数を捨てる', () => {
  const u = sanitizeUsage({
    day: '2026-10-09',
    device: 'd_abc123',
    c: { open: 2, title: 5, work_quiz: -1, walk_done: 99999, exit_core_3_x: 1.9 },
    r: { n: 25, c: 3, l: 0 },
  });
  assert.deepEqual(u, { day: '2026-10-09', device: 'd_abc123', c: { open: 2, walk_done: 500, exit_core_3_x: 1 }, r: { n: 25, c: 3, l: 0 } });
  assert.equal(sanitizeUsage({ day: '2026/10/09', device: 'd_abc123', c: {} }), null);
  assert.equal(sanitizeUsage({ day: '2026-10-09', device: 'x y', c: {} }), null);
  assert.equal(sanitizeUsage({ day: '2026-10-09', device: 'd_abc123', c: {}, r: { n: 'a' } }).r, null);
});

test('端末の日付は前後数日だけ受ける', () => {
  const now = Date.parse('2026-10-09T03:00:00Z');
  assert.ok(usageDayAllowed('2026-10-09', now));
  assert.ok(usageDayAllowed('2026-10-08', now));
  assert.ok(!usageDayAllowed('2026-09-01', now));
  assert.ok(!usageDayAllowed('2026-10-20', now));
});

function fakeRedis() {
  const calls = [];
  const store = new Map();
  const fetchImpl = async (url, init) => {
    const cmds = JSON.parse(init.body);
    calls.push(cmds);
    const out = cmds.map(([op, key, ...rest]) => {
      if (op === 'HSET') {
        const h = store.get(key) || new Map();
        h.set(rest[0], rest[1]);
        store.set(key, h);
        return { result: 1 };
      }
      if (op === 'HDEL') {
        const h = store.get(key);
        rest.forEach((f) => h?.delete(f));
        return { result: 1 };
      }
      if (op === 'HGETALL') return { result: [...(store.get(key) || new Map())].flat() };
      if (op === 'HKEYS') return { result: [...(store.get(key) || new Map()).keys()] };
      return { result: 1 };
    });
    return new Response(JSON.stringify(out));
  };
  return { calls, store, fetchImpl };
}

test('保存: 番号は元の ID を含まない・ログインしたら同じ端末の未ログインの行を消す', async () => {
  const r = fakeRedis();
  const orig = globalThis.fetch;
  globalThis.fetch = r.fetchImpl;
  try {
    const u = sanitizeUsage({ day: '2026-10-09', device: 'd_dev1', c: { open: 1 }, r: { n: 1, c: 0, l: 2 } });
    await writeUsage(u, { env: ENV });
    const anon = usageIds({ device: 'd_dev1' }, ENV);
    assert.equal(anon.person, anon.device);
    assert.ok(r.store.get('usage:d:20261009').has(`${anon.device}.${anon.device}`));

    await writeUsage({ ...u, c: { open: 2 } }, { uid: '11111111-2222-3333-4444-555555555555', env: ENV });
    const h = r.store.get('usage:d:20261009');
    assert.equal(h.size, 1); // 未ログインの行は消えた
    const [field, val] = [...h][0];
    assert.ok(!field.includes('11111111'));
    assert.ok(!field.includes('d_dev1'));
    assert.deepEqual(JSON.parse(val), { L: 1, c: { open: 2 }, r: { n: 1, c: 0, l: 2 } });
    assert.ok(r.calls.flat().some(([op, , ttl]) => op === 'EXPIRE' && ttl === String(120 * 86400)));

    const rows = await readUsageRows(7, { now: Date.parse('2026-10-09T03:00:00Z'), env: ENV });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].day, '2026-10-09');
    assert.equal(rows[0].L, 1);

    await deleteUsageFor('11111111-2222-3333-4444-555555555555', { now: Date.parse('2026-10-09T03:00:00Z'), env: ENV });
    assert.equal(r.store.get('usage:d:20261009').size, 0);
  } finally {
    globalThis.fetch = orig;
  }
});

test('月の生成数のキーは生の uid を含まない（JST の年月）', () => {
  const k = genMonthKey('11111111-2222-3333-4444-555555555555', Date.parse('2026-10-31T16:00:00Z'));
  assert.match(k, /^gen:month:202611:[0-9a-f]{16}$/);
});

const row = (day, p, c = {}, r = null, L = 1) => ({ day, p, d: p, L, c, r });

test('週次の表: 人数・割合・予習の流れ・抜けた場所・復習の語数', () => {
  const today = '2026-10-14';
  assert.deepEqual(weekWindows(today, 2), [
    { from: '2026-10-08', to: '2026-10-14' },
    { from: '2026-10-01', to: '2026-10-07' },
  ]);
  const rows = [
    row('2026-10-14', 'a', { open: 3, work_quiz: 2, list_open: 1, walk_start: 1, walk_core: 1, walk_done: 1 }, { n: 25, c: 5, l: 0 }),
    row('2026-10-13', 'a', { open: 1, exit_list_10_walk: 1 }, { n: 30, c: 0, l: 4 }),
    row('2026-10-12', 'a', {}, { n: 21, c: 0, l: 0 }),
    row('2026-10-11', 'a', {}, { n: 22, c: 0, l: 0 }),
    row('2026-10-14', 'b', { open: 1, list_open: 1, exit_list_2_nav: 1, exit_core_4_later: 1 }, { n: 0, c: 0, l: 120 }, 0),
    row('2026-10-02', 'c', { open: 1, journey_tab: 1 }),
  ];
  const rep = buildUsageReport(rows, { today, weeks: 2 });
  assert.equal(rep.plus[0].開いた人, 2);
  assert.equal(rep.plus[0].ログイン, 1);
  assert.equal(rep.plus[0]['プラス機能を1つでも'], '1 (50%)');
  assert.equal(rep.plus[0]['作品・話のクイズ'], '1人 50% / 2回');
  assert.equal(rep.plus[1]['あゆみ(タブ)'], '1人 100% / 1回');
  assert.equal(rep.funnel[0]['①リストを開いた'], '2人 / 2回');
  assert.equal(rep.funnel[0]['⑥予習完了'], '1人 50% / 1回');
  const list = rep.exits.find((e) => e.段階 === '①一覧');
  assert.equal(list.計, 2);
  assert.equal(list.最後まで, 1);
  assert.equal(list.カードへ, 1);
  assert.equal(rep.exits.find((e) => e.段階 === '④までのカード').あとで, 1);
  assert.equal(rep.review[0].復習した人, 1);
  assert.equal(rep.review[0]['20語超 4日+'], 1);
  assert.equal(rep.review[0]['残り101-'], 1);
  const hints = usageHints(rep, rows, { today });
  assert.match(hints[0], /1\/2（50%）/);
  assert.match(hints[1], /1\/1（100%）/);
});

test('週次の表: 初回アンケートの進み具合', () => {
  const today = '2026-11-07';
  const rows = [
    row('2026-11-01', 'a', { open: 1, ob_q1: 1 }, null, 0),
    row('2026-11-02', 'b', { open: 1, ob_q1: 1, ob_q2: 2, ob_skip_q2: 1, ob_q3: 1, ob_q4: 1, ob_q5: 1, ob_skip_q5: 1, ob_plan: 1, ob_done: 1 }, null, 0),
    row('2026-11-03', 'c', { open: 1 }, null, 0),
  ];
  const ob = buildUsageReport(rows, { today, weeks: 1 }).onboarding[0];
  assert.equal(ob['1問目 レベル'], '2人');
  assert.equal(ob['2問目 サービス'], '1人 50%');
  assert.equal(ob.完了, '1人 50%');
  assert.equal(ob.スキップ2, 1);
  assert.equal(ob.スキップ3, 0);
  assert.equal(ob.スキップ5, 1);
});

test('初回アンケートの項目は数えてよい名前・それ以外の ob_ は捨てる', () => {
  for (const k of ['ob_q1', 'ob_q5', 'ob_skip_q2', 'ob_skip_q5', 'ob_plan', 'ob_done']) assert.ok(isUsageEvent(k), k);
  for (const k of ['ob_q6', 'ob_skip_q1', 'ob_answer_netflix']) assert.ok(!isUsageEvent(k), k);
});

test('月の新規生成の分布と CSV', () => {
  const t = genMonthTable([{ month: '202610', counts: [40, 8, 5, 1, 1] }]);
  assert.equal(t[0].生成した人, 5);
  assert.equal(t[0]['1話'], 2);
  assert.equal(t[0]['31話-'], 1);
  assert.equal(t[0]['5話超'], '40%');
  assert.equal(t[0]['30話超'], '20%');
  const csv = usageCsv([row('2026-10-02', 'x', { open: 1 }, { n: 2, c: 1, l: 0 })]);
  assert.equal(csv, 'day,person,device,logged_in,new_words,continued_words,due_left,open\n2026-10-02,x,x,1,2,1,0,1\n');
});

test('新規の人の項目は数えてよい名前（2026-11-04）', () => {
  for (const k of ['auth_shown', 'auth_signup', 'auth_login', 'auth_local', 'work_select', 'ext_first_save', 'ext_install_open']) assert.ok(isUsageEvent(k), k);
  for (const k of ['auth_close', 'ext_entry', 'from_ext']) assert.ok(!isUsageEvent(k), k);
});

test('拡張で保存した語の判定: source が配信サイト名なら拡張・star/manual/無しはアプリ', () => {
  assert.ok(isExtSavedWord({ word: 'hustle', source: 'Netflix' }));
  assert.ok(isExtSavedWord({ word: 'hustle', source: 'Prime Video' }));
  assert.ok(!isExtSavedWord({ word: 'hustle', source: 'star' }));
  assert.ok(!isExtSavedWord({ word: 'hustle', source: 'manual' }));
  assert.ok(!isExtSavedWord({ word: 'hustle' }));
  assert.ok(!isExtSavedWord({ word: 'hustle', source: '' }));
  assert.ok(!isExtSavedWord(null));
  assert.ok(hasExtSavedWord([{ source: 'star' }, { source: 'Disney+' }]));
  assert.ok(!hasExtSavedWord([{ source: 'star' }, {}]));
  assert.ok(!hasExtSavedWord('not an array'));
});

test('週次の表: 新規の人（初めて開いた週）と再訪・入口とログイン画面', () => {
  const today = '2026-11-14';
  const rows = [
    // a: 表より前の週（11-01〜07 のさらに前）から使っている人＝新規に数えない
    row('2026-10-30', 'a', { open: 1, auth_shown: 1, auth_login: 1 }),
    row('2026-11-10', 'a', { open: 1, work_select: 1 }),
    // b: 11-09 に初めて開いた（直近の週）。ログイン画面→このデバイスのみ→作品を選んだ→翌日も来た
    row('2026-11-09', 'b', { open: 2, auth_shown: 1, auth_local: 1, work_select: 1, list_open: 1 }, null, 0),
    row('2026-11-10', 'b', { open: 1 }, null, 0),
    // c: 11-02 に初めて開いた（前の週）。拡張から来て新規登録→5日後に戻って拡張の語が届いた
    row('2026-11-02', 'c', { open: 1, ext_install_open: 1, auth_shown: 2, auth_signup: 1 }),
    row('2026-11-07', 'c', { open: 1, ext_first_save: 1 }),
    // d: 11-03 に初めて開いた。ログイン画面を見ただけ
    row('2026-11-03', 'd', { open: 1, auth_shown: 1 }, null, 0),
  ];
  const rep = buildUsageReport(rows, { today, weeks: 2 });
  const [w0, w1] = rep.newUsers;
  assert.equal(w0.週, '11-08〜11-14');
  assert.equal(w0.新規の人, 1);
  assert.equal(w0['ログイン画面'], '1 100%');
  assert.equal(w0['このデバイスのみ'], '1 100%');
  assert.equal(w0['新規登録'], '0 0%');
  assert.equal(w0['作品を選んだ'], '1 100%');
  assert.equal(w0['翌日再訪'], '1（集計中）'); // 週末の翌日がまだ来ていない
  assert.equal(w0['7日内再訪'], '1（集計中）');
  assert.equal(w1.新規の人, 2); // c と d（a は前から使っている）
  assert.equal(w1['拡張から来た'], '1 50%');
  assert.equal(w1['新規登録'], '1 50%');
  assert.equal(w1['拡張で初保存'], '1 50%');
  assert.equal(w1['翌日再訪'], '0 0%');
  assert.equal(w1['7日内再訪'], '1 50%');
  // ⑧ 全員（a も含む）
  assert.equal(rep.entry[0].開いた人, 2);
  assert.equal(rep.entry[0]['作品を選んだ'], '2人 100% / 2回');
  assert.equal(rep.entry[1]['ログイン画面'], '2人 100% / 3回');
  const hint = usageHints(rep, rows, { today }).find((l) => l.includes('初めて開いた人'));
  assert.match(hint, /初めて開いた人 1: ログイン画面を見た 1・新規登録 0・このデバイスのみ 1・作品を選んだ 1・拡張で初保存 0/);
});

test('初回体験の項目は数えてよい名前（2026-11-05・作品・予習部門の画面と同じ）', () => {
  for (const k of ['trial_start', 'trial_welcome', 'trial_intro', 'trial_level', 'trial_pick', 'trial_list', 'trial_walk_done', 'trial_quiz_done', 'trial_done', 'trial_signup_click', 'trial_later', 'trial_next', 'trial_later_band']) assert.ok(isUsageEvent(k), k);
  for (const k of ['trial_work_37680', 'trial_level_b1', 'trial_exit']) assert.ok(!isUsageEvent(k), k);
});

test('ゲスト→登録の結合: 同じ端末でログインした人のゲスト行をその人に寄せる（集計側だけ）', () => {
  const rows = [
    { day: '2026-11-03', p: 'dev1', d: 'dev1', L: 0, c: { open: 1, trial_start: 1 }, r: null }, // ゲスト
    { day: '2026-11-04', p: 'u1', d: 'dev1', L: 1, c: { open: 1, auth_signup: 1 }, r: null }, // 同じ端末で登録
    { day: '2026-11-02', p: 'dev2', d: 'dev2', L: 0, c: { open: 1 }, r: null }, // ゲストのまま
    { day: '2026-11-04', p: 'u2', d: 'dev3', L: 1, c: { open: 1 }, r: null }, // 最初からログイン
    { day: '2026-11-05', p: 'u9', d: 'dev1', L: 1, c: { open: 1 }, r: null }, // 同じ端末の2人目（寄せる先は最初の u1）
  ];
  const j = joinGuestRows(rows);
  assert.equal(j[0].p, 'u1');
  assert.equal(j[0].joined, true);
  assert.equal(j[2].p, 'dev2');
  assert.equal(j[2].joined, undefined);
  assert.equal(j[4].p, 'u9');
  assert.deepEqual(rows[0].p, 'dev1'); // 元の行は変えない
  // ⑦ では 1 人（11-03 に初めて開いた人＝u1）になり、登録もその人に付く
  const rep = buildUsageReport(rows, { today: '2026-11-05', weeks: 1 });
  assert.equal(rep.newUsers[0].新規の人, 4); // u1(dev1・11-03 から)・dev2・u2・u9
  assert.equal(rep.newUsers[0]['新規登録'], '1 25%');
  assert.equal(rep.plus[0].開いた人, 4); // u1・dev2・u2・u9
  assert.equal(rep.joinedRows, 1);
  assert.ok(usageHints(rep, rows, { today: '2026-11-05' }).some((l) => l.includes('寄せた行: 1')));
});

test('週次の表: 初回体験の流れ（⑨）', () => {
  const today = '2026-11-07';
  const rows = [
    row('2026-11-05', 'a', { open: 1, trial_start: 1, trial_level: 1, trial_pick: 1, trial_list: 1, trial_walk_done: 1, trial_quiz_done: 1, trial_done: 1, trial_signup_click: 1 }, null, 0),
    row('2026-11-06', 'b', { open: 1, trial_start: 2, trial_level: 1, trial_pick: 1, trial_list: 1, trial_later: 1 }, null, 0),
    row('2026-11-06', 'c', { open: 1, trial_start: 1 }, null, 0),
  ];
  const rep = buildUsageReport(rows, { today, weeks: 1 });
  const t = rep.trial[0];
  assert.equal(t['最初の画面'], '3人 / 4回');
  assert.equal(t['作品'], '2人 67% / 2回');
  assert.equal(t['完了画面'], '1人 33% / 1回');
  assert.equal(t['登録へ'], '1人 33% / 1回');
  assert.equal(t['あとで'], '1人 33% / 1回');
  assert.equal(t['次回の帯'], '0人 0% / 0回');
  const hint = usageHints(rep, rows, { today }).find((l) => l.includes('初回体験'));
  assert.match(hint, /最初の画面 3人 → 作品 2 → 予習5枚 1 → 完了画面 1 → 登録へ 1／あとで 1/);
});

test('運営の端末の印: 送られてきた staff を s として通す（無ければ付けない）・保存と読み出しで S が残る', async () => {
  assert.equal(sanitizeUsage({ day: '2026-11-07', device: 'd_abc123', c: { open: 1 }, staff: 1 }).s, 1);
  assert.equal(sanitizeUsage({ day: '2026-11-07', device: 'd_abc123', c: { open: 1 }, staff: true }).s, 1);
  assert.equal('s' in sanitizeUsage({ day: '2026-11-07', device: 'd_abc123', c: { open: 1 }, staff: 'yes' }), false);
  assert.equal('s' in sanitizeUsage({ day: '2026-11-07', device: 'd_abc123', c: { open: 1 } }), false);
  const r = fakeRedis();
  const orig = globalThis.fetch;
  globalThis.fetch = r.fetchImpl;
  try {
    await writeUsage(sanitizeUsage({ day: '2026-11-07', device: 'd_staff1', c: { open: 1 }, staff: 1 }), { env: ENV });
    await writeUsage(sanitizeUsage({ day: '2026-11-07', device: 'd_user1', c: { open: 1 } }), { env: ENV });
    const rows = await readUsageRows(3, { now: Date.parse('2026-11-07T03:00:00Z'), env: ENV });
    const staff = rows.find((x) => x.S);
    assert.ok(staff);
    assert.equal(rows.filter((x) => x.S).length, 1);
    assert.equal(staff.d, usageIds({ device: 'd_staff1' }, ENV).device);
  } finally {
    globalThis.fetch = orig;
  }
});

test('運営の端末・アカウントを外す: 印の端末→そこでログインした人→その人の別の端末→そこのテスト用アカウント…とたどり、過去の行も外す', () => {
  const rows = [
    // オーナーの PC（11/7 に印）。10/30 は印の無い行・11/5 はテスト用アカウント t1 でログイン
    { day: '2026-10-30', p: 'pc', d: 'pc', L: 0, c: { open: 1 } },
    { day: '2026-11-05', p: 't1', d: 'pc', L: 1, c: { open: 1, auth_signup: 1 } },
    { day: '2026-11-07', p: 'owner', d: 'pc', L: 1, c: { open: 1 }, S: 1 },
    // オーナーの iPhone（印なし）だが owner でログインしたことがある → 外れる。そこのゲストの行も外れる
    { day: '2026-11-06', p: 'iphone', d: 'iphone', L: 0, c: { open: 1, trial_start: 1 } },
    { day: '2026-11-06', p: 'owner', d: 'iphone', L: 1, c: { open: 1 } },
    // テスト用アカウント t1 が別の端末でもログイン → その端末も外れる
    { day: '2026-11-06', p: 't1', d: 'phone2', L: 1, c: { open: 1 } },
    // 本当の利用者（つながらない）
    { day: '2026-11-04', p: 'u9', d: 'u9', L: 0, c: { open: 1, trial_start: 1 } },
    { day: '2026-11-07', p: 'real', d: 'devR', L: 1, c: { open: 1, auth_signup: 1 } },
  ];
  const comp = staffComponent(rows);
  assert.deepEqual([...comp.devices].sort(), ['iphone', 'pc', 'phone2']);
  assert.deepEqual([...comp.persons].sort(), ['owner', 't1']);
  const x = excludeStaff(rows);
  assert.deepEqual(x.rows.map((r) => r.p), ['u9', 'real']);
  assert.deepEqual(x.excluded, { rows: 6, devices: 3, persons: 2 });
  // 印が無くても、seed から渡す運営の番号（excludePersons）から同じようにたどる
  const noFlag = rows.map(({ S, ...r }) => r);
  assert.deepEqual(excludeStaff(noFlag, { persons: ['owner'] }).rows.map((r) => r.p), ['u9', 'real']);
  // 何も渡さなければ何も外さない
  assert.equal(excludeStaff(noFlag).rows.length, rows.length);
  // 週次の表: 既定で外す・--include-staff 相当で含める
  const rep = buildUsageReport(rows, { today: '2026-11-07', weeks: 1 });
  assert.equal(rep.newUsers[0].新規の人, 2);
  assert.equal(rep.newUsers[0]['新規登録'], '1 50%');
  assert.deepEqual(rep.staffExcluded, { rows: 6, devices: 3, persons: 2 });
  const all = buildUsageReport(rows, { today: '2026-11-07', weeks: 1, includeStaff: true });
  assert.equal(all.staffExcluded, null);
  assert.ok(all.entry[0].開いた人 > rep.entry[0].開いた人);
  assert.ok(usageHints(rep, rows, { today: '2026-11-07' }).some((l) => l.includes('運営の端末・アカウントを外した: 端末 3・人 2・行 6')));
});

test('端末の番号の除外リスト: 印を付けられない確認用ブラウザの行だけを外す（行に無い番号は数えない）', () => {
  const rows = [
    { day: '2026-11-07', p: 'e1', d: 'e1', L: 0, c: { open: 1, ext_install_open: 1 } },
    { day: '2026-11-07', p: 'e2', d: 'e2', L: 0, c: { open: 1, ext_install_open: 1 } },
    { day: '2026-11-07', p: 'u1', d: 'u1', L: 0, c: { open: 1 } },
  ];
  const x = excludeStaff(rows, { devices: ['e1', 'e2', 'zz'] });
  assert.deepEqual(x.rows.map((r) => r.p), ['u1']);
  assert.deepEqual(x.excluded, { rows: 2, devices: 2, persons: 0 });
  const rep = buildUsageReport(rows, { today: '2026-11-07', weeks: 1, excludeDevices: ['e1', 'e2'] });
  assert.equal(rep.newUsers[0].新規の人, 1);
  assert.equal(rep.newUsers[0]['拡張から来た'], '0 0%');
});

test('単語を学ぶの流れ（⑫）: 7つの名前を通し、始めた人に対する割合・作品を選んだ人のうち・初めての5枚は端末で数える', () => {
  for (const k of ['learn_start', 'learn_done', 'learn_more', 'learn_quit', 'learn_first', 'home_learn', 'home_quiz']) assert.ok(isUsageEvent(k), k);
  assert.ok(!isUsageEvent('learn_word_trust'));
  const rows = [
    { day: '2026-11-13', p: 'a', d: 'a', L: 0, c: { work_select: 1, learn_start: 2, learn_done: 1, learn_more: 1, learn_first: 1, home_learn: 1 } },
    { day: '2026-11-13', p: 'b', d: 'b', L: 0, c: { work_select: 1, learn_start: 1, learn_quit: 1, learn_first: 1, home_quiz: 2 } },
    { day: '2026-11-13', p: 'c', d: 'c', L: 0, c: { work_select: 1 } },
    { day: '2026-11-13', p: 'u1', d: 'pc', L: 1, c: { work_select: 1, learn_start: 1, learn_done: 1, learn_first: 1 } },
    { day: '2026-11-13', p: 'u1', d: 'phone', L: 1, c: { learn_first: 1 } }, // 同じ人の別の端末＝初めての5枚は端末で2
  ];
  const lf = buildUsageReport(rows, { today: '2026-11-13', weeks: 1 }).learn[0];
  assert.equal(lf['始めた'], '3人 / 4回');
  assert.equal(lf['作品を選んだ人のうち'], '75%');
  assert.equal(lf['最後まで'], '2人 67% / 2回');
  assert.equal(lf['続けた'], '1人 33% / 1回');
  assert.equal(lf['途中で抜けた'], '1人 33% / 1回');
  assert.equal(lf['初めての5枚（端末）'], 4);
  assert.equal(lf['ホームの「学ぶ」'], '1人 / 1回');
  assert.equal(lf['ホームの「クイズ」'], '1人 / 2回');
});
