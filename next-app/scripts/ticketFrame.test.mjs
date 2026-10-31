// 半券の額縁（lib/ticketFrame.js）のテスト・2026-10-31
// 達成度で段階が上がり、割合が下がっても届いた段階は戻らないこと。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = globalThis.window || {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { FRAME_TIERS, frameTierFor, raiseFrameBest, frameTierOf, loadFrameBest, saveFrameBest, frameBestKey } =
  await import('../lib/ticketFrame.js');

const keyOf = (i) => FRAME_TIERS[i].key;

test('frameTierFor: 境目ちょうどで次の額縁に届く', () => {
  assert.equal(keyOf(frameTierFor(null)), 'plain');
  assert.equal(keyOf(frameTierFor(0)), 'plain');
  assert.equal(keyOf(frameTierFor(29)), 'plain');
  assert.equal(keyOf(frameTierFor(30)), 'black');
  assert.equal(keyOf(frameTierFor(59)), 'black');
  assert.equal(keyOf(frameTierFor(60)), 'silver');
  assert.equal(keyOf(frameTierFor(89)), 'silver');
  assert.equal(keyOf(frameTierFor(90)), 'gold');
  assert.equal(keyOf(frameTierFor(100)), 'gold');
});

test('raiseFrameBest: 上がった作品だけ記録し、下がった作品は据え置く', () => {
  const best = { Suits: 3, Friends: 1 };
  const { best: out, changed } = raiseFrameBest(best, [
    { title: 'Suits', progress: 40 }, // 金縁に届いた後で割合が下がった
    { title: 'Friends', progress: 65 }, // 黒縁 → 銀縁
    { title: 'Lost', progress: null }, // 語が無い作品
  ]);
  assert.equal(changed, true);
  assert.deepEqual(out, { Suits: 3, Friends: 2 });
  assert.deepEqual(best, { Suits: 3, Friends: 1 }); // 元のオブジェクトは書き換えない
});

test('raiseFrameBest: 何も上がらなければ changed は false', () => {
  const { changed } = raiseFrameBest({ Suits: 2 }, [{ title: 'Suits', progress: 10 }]);
  assert.equal(changed, false);
});

test('frameTierOf: 保存済みの最高段階と今の段階の大きい方', () => {
  assert.equal(keyOf(frameTierOf({ Suits: 3 }, 'Suits', 10)), 'gold');
  assert.equal(keyOf(frameTierOf({}, 'Suits', 61)), 'silver');
});

test('loadFrameBest / saveFrameBest: プロフィール別のキーで往復できる', () => {
  saveFrameBest('p1', { Suits: 2 });
  assert.equal(frameBestKey('p1'), 'cl_frame_best_p1');
  assert.deepEqual(loadFrameBest('p1'), { Suits: 2 });
  assert.deepEqual(loadFrameBest('p2'), {});
  store.set('cl_frame_best_p3', '[1,2]'); // 壊れた値は空として扱う
  assert.deepEqual(loadFrameBest('p3'), {});
});
