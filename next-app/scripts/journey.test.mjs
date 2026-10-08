// lib/journey.js（語彙のあゆみ＝草と週ごとの推移）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNEY, expByDay, grassThresholds, grassLevel, buildGrass, buildTrend, dayDetail } from '../lib/journey.js';

const D = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

test('expByDay は端末をまたいで日ごとに合計し、壊れたキーは捨てる', () => {
  const r = expByDay({ '2026-08-08|d_a': 10, '2026-08-08|d_b': 5, '2026-08-09|d_a': '7', bad: 3 });
  assert.deepEqual(r, { '2026-08-08': 15, '2026-08-09': 7 });
});

test('濃さは学習日の中の四分位（0日は 0・最大は最上段）', () => {
  const vals = [1, 2, 3, 4, 5, 6, 7, 8];
  const th = grassThresholds(vals);
  assert.equal(th.length, JOURNEY.grassLevels.length - 1);
  assert.equal(grassLevel(0, th), 0);
  assert.equal(grassLevel(1, th), 1);
  assert.equal(grassLevel(8, th), JOURNEY.grassLevels.length);
  // 単調
  let prev = 0;
  vals.forEach((v) => {
    const lv = grassLevel(v, th);
    assert.ok(lv >= prev);
    prev = lv;
  });
});

test('草は記録の始まった週の日曜から今日の週まで・それより前と未来は out', () => {
  const g = buildGrass({ '2026-08-08|d': 10, '2026-10-08|d': 30, '2026-10-01|d': 0 }, D('2026-10-08'));
  // 2026-08-08 は土曜 → 最初の週は 8/2（日）
  assert.equal(g.weeks[0].days[0].ymd, '2026-08-02');
  assert.equal(g.weeks[0].month, '8月');
  assert.ok(g.weeks[0].days.slice(0, 6).every((d) => d.out));
  assert.equal(g.weeks[0].days[6].out, false);
  const last = g.weeks[g.weeks.length - 1];
  assert.equal(last.days[4].ymd, '2026-10-08');
  assert.equal(last.days[4].today, true);
  assert.equal(last.days[5].out, true);
  assert.equal(g.studied, 2); // EXP 0 の日は数えない
  assert.equal(g.thisMonth, 1);
  assert.equal(g.weeks.filter((w) => w.month === '9月').length, 1);
});

test('台帳が空でも今日の週だけ描ける', () => {
  const g = buildGrass({}, D('2026-10-08'));
  assert.equal(g.weeks.length, 1);
  assert.equal(g.studied, 0);
});

test('推移は4週たまるまで ready=false、記録週数は開始日から数える', () => {
  const t = buildTrend({ '2026-10-08': { learned: 10 } }, D('2026-10-08'));
  assert.equal(t.ready, false);
  assert.equal(t.recorded, 0);
  const t2 = buildTrend({ '2026-10-08': { learned: 10 } }, D('2026-11-04'));
  assert.equal(t2.recorded, 4);
  assert.equal(t2.ready, true);
  assert.equal(buildTrend({}, D('2026-10-08')).start, null);
});

test('推移の覚えた・マスターは週末までの最高値で下がらず、思い出せた数は週の合計', () => {
  const days = {
    '2026-10-04': { learned: 10, mastered: 1, ok: 3 },
    '2026-10-05': { learned: 12, mastered: 1, ok: 4 },
    '2026-10-12': { learned: 9, mastered: 0, ok: 2 }, // 判定が外れても線は下がらない
    '2026-10-26': { learned: 20, mastered: 3, ok: 5 },
  };
  const t = buildTrend(days, D('2026-11-02'), { minWeeks: 4, weeks: 12 });
  assert.deepEqual(
    t.series.map((s) => [s.learned, s.mastered, s.ok]),
    [
      [12, 1, 7],
      [12, 1, 2],
      [12, 1, 0], // 記録の無い週は前の値を引き継ぐ
      [20, 3, 5],
      [20, 3, 0],
    ]
  );
  const t2 = buildTrend(days, D('2027-03-01'), { weeks: 12 });
  assert.equal(t2.series.length, 12);
});

test('マスの中身: 覚えた・マスターの増分は前日までの最高値との差・前の記録が無ければ出さない', () => {
  const days = {
    '2026-10-08': { learned: 10, mastered: 2, ok: 5, sec: 30 },
    '2026-10-09': { learned: 13, mastered: 2, ok: 8, sec: 600 },
    '2026-10-10': { ok: 2, sec: 0 },
    '2026-10-12': { learned: 13, mastered: 4, ok: 6, sec: 120 },
  };
  assert.deepEqual(dayDetail(days, '2026-10-08'), { ok: 5, min: 1, gain: null, masteredGain: null });
  assert.deepEqual(dayDetail(days, '2026-10-09'), { ok: 8, min: 10, gain: 3, masteredGain: 0 });
  assert.deepEqual(dayDetail(days, '2026-10-10'), { ok: 2, min: 0, gain: null, masteredGain: null });
  assert.equal(dayDetail(days, '2026-10-11'), null);
  assert.deepEqual(dayDetail(days, '2026-10-12'), { ok: 6, min: 2, gain: 0, masteredGain: 2 });
});
