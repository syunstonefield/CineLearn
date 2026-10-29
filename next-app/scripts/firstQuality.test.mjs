// 初回の答え（lib/storage.js reviewWord の firstQuality と firstLearnStats）のテスト・2026-10-29
import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage の代用品（storage.js は window がある時だけ読む＝window も置く）
const store = new Map();
globalThis.window = globalThis.window || {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { reviewWord, skipWord, firstLearnStats, loadSrs, SRS_KEY } = await import('../lib/storage.js');

const reset = () => localStorage.removeItem(SRS_KEY);

test('新しい語の最初の採点だけ firstQuality が付き、以後は上書きしない', () => {
  reset();
  reviewWord('alpha', 0);
  assert.equal(loadSrs().alpha.firstQuality, 0);
  reviewWord('alpha', 5); // 同日2回目（練習扱い）
  assert.equal(loadSrs().alpha.firstQuality, 0);
  reviewWord('alpha', 3); // 同日の失敗側（スケジュール反映）
  assert.equal(loadSrs().alpha.firstQuality, 0);
  assert.equal(loadSrs().alpha.reviewCount, 3);
});

test('記録開始前からの語（firstQuality 無し）には付かない', () => {
  reset();
  localStorage.setItem(SRS_KEY, JSON.stringify({ old: { interval: 6, repetitions: 2, easeFactor: 2.5, dueDate: '2000-01-01', lastReview: '2000-01-01' } }));
  reviewWord('old', 0);
  assert.equal(loadSrs().old.firstQuality, undefined);
});

test('skipWord で作られた語（知ってるで外した）には付かない', () => {
  reset();
  skipWord('known');
  assert.equal(loadSrs().known.firstQuality, undefined);
  reviewWord('known', 0); // 後で採点しても既存エントリなので付かない
  assert.equal(loadSrs().known.firstQuality, undefined);
});

test('firstLearnStats の内訳（skipped は除外）', () => {
  reset();
  reviewWord('a', 0); reviewWord('b', 0); reviewWord('c', 3); reviewWord('d', 5);
  reviewWord('e', 5); skipWord('e'); // 採点後に「知ってる」で外した語は数えない
  localStorage.setItem(SRS_KEY, JSON.stringify({ ...loadSrs(), old: { interval: 1, repetitions: 1, easeFactor: 2.5 } }));
  assert.deepEqual(firstLearnStats(loadSrs()), { recorded: 4, unknown: 2, shaky: 1, known: 1 });
});
