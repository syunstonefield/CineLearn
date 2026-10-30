// 視聴後クイズの EXP（lib/quizAward.js）のテスト・2026-10-30
// 答えた問題ごとに2・同じ話の同じ問題は1回だけ・合格ボーナスは初回合格だけ。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = globalThis.window || {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { awardQuizAnswer, quizPassBonus } = await import('../lib/quizAward.js');
const { totalExp } = await import('../lib/exp.js');

test('答えた問題ごとに2・同じ話の同じ問題は2回目以降0（途中→再挑戦でも重ならない）', () => {
  store.clear();
  assert.equal(awardQuizAnswer('h1', 'Verdict'), 2);
  assert.equal(awardQuizAnswer('h1', 'plea'), 2);
  assert.equal(totalExp(), 4);
  // 途中でやめて再挑戦：同じ問題は付かず、新しい問題だけ付く
  assert.equal(awardQuizAnswer('h1', 'verdict'), 0);
  assert.equal(awardQuizAnswer('h1', 'plea'), 0);
  assert.equal(awardQuizAnswer('h1', 'acquit'), 2);
  assert.equal(totalExp(), 6);
});

test('別の話なら同じ語でも別に付く', () => {
  assert.equal(awardQuizAnswer('h2', 'verdict'), 2);
});

test('合格ボーナスは初回合格だけ・不合格や2回目の合格は0', () => {
  assert.equal(quizPassBonus(80, null), 20);
  assert.equal(quizPassBonus(60, 40), 20);
  assert.equal(quizPassBonus(40, null), 0);
  assert.equal(quizPassBonus(100, 60), 0);
});

test('最後まで5問で初回合格した時の合計は旧仕様（語数×2＋20）と同じ', () => {
  store.clear();
  const words = ['a', 'b', 'c', 'd', 'e'];
  const perQ = words.reduce((s, w) => s + awardQuizAnswer('h3', w), 0);
  assert.equal(perQ + quizPassBonus(80, null), 5 * 2 + 20);
});
