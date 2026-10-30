// 復習セッションの記録＋EXP（lib/reviewAward.js）のテスト・2026-10-30
// 途中でやめた時も、採点した語だけで完了時と同じ計算になること。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = globalThis.window || {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { awardReviewSession, tallyRatings } = await import('../lib/reviewAward.js');
const { totalExp } = await import('../lib/exp.js');
const { getTodaySessions } = await import('../lib/storage.js');

const W = (n) => Array.from({ length: n }, (_, i) => ({ word: `w${i}` }));

test('tallyRatings: 未採点は数えず、採点済みの内訳だけ', () => {
  const q = W(4);
  assert.deepEqual(tallyRatings(q, { w0: 0, w1: 3, w2: 5, w3: 5 }), { failed: 1, hard: 1, easy: 2 });
});

test('途中の3語でも完了時と同じ式（カード×2＋昇格ボーナス）で付き、今日N回目に記録される', () => {
  store.clear();
  const before = totalExp();
  const rated = W(5).slice(0, 3);
  const r = awardReviewSession({ queue: rated, ratings: { w0: 5, w1: 0, w2: 3 }, promo: { learned: ['w0'], mastered: [] }, historyId: 'h1' });
  assert.equal(r.earned, 3 * 2 + 5);
  assert.equal(totalExp() - before, 11);
  assert.equal(r.num, 1);
  const s = getTodaySessions('h1');
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].easy, s[0].hard, s[0].fail, s[0].total], [1, 1, 1, 3]);
});

test('続きを別セッションでやれば 2回目として別に記録（同じ語を重ねなければ二重にならない）', () => {
  const r = awardReviewSession({ queue: W(5).slice(3), ratings: { w3: 5, w4: 5 }, promo: { learned: [], mastered: [] }, historyId: 'h1' });
  assert.equal(r.num, 2);
  assert.equal(r.earned, 4);
  assert.equal(getTodaySessions('h1').length, 2);
});
