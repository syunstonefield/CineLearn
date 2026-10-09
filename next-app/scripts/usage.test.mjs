// ベータの利用データ（lib/usageEvents.js・lib/usageReport.js・lib/server/usage.js）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUsage, exitEventName, parseExitEvent, toDecile, isUsageEvent } from '../lib/usageEvents.js';
import { buildUsageReport, genMonthTable, usageCsv, weekWindows, usageHints } from '../lib/usageReport.js';
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
