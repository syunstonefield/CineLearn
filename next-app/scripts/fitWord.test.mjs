// 復習カードの語を1行に収める計算（lib/fitWord.js）のテスト・2026-11-07
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitFontSize, FIT_MIN_PX } from '../lib/fitWord.js';

test('入るならそのまま', () => {
  assert.deepEqual(fitFontSize(48, 250, 300, 26), { size: 48, wrap: false });
});
test('入らなければ幅に合わせて縮める（少しゆとりを残す）', () => {
  const r = fitFontSize(48, 400, 300, 26);
  assert.equal(r.wrap, false);
  assert.ok(r.size <= 36 && r.size >= 34, String(r.size));
});
test('下限でも入らない時だけ折り返す', () => {
  assert.deepEqual(fitFontSize(48, 900, 300, FIT_MIN_PX.front), { size: FIT_MIN_PX.front, wrap: true });
});
test('測れない時は何もしない', () => {
  assert.deepEqual(fitFontSize(48, 0, 300, 26), { size: 48, wrap: false });
});
