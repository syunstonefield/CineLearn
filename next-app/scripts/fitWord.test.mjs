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

test('空白の無い1語は語の途中で折らず、下限を割ってでも1行（reconnaissance などの実例）', async () => {
  const { FIT_FLOOR_PX } = await import('../lib/fitWord.js');
  const r = fitFontSize(48, 900, 300, FIT_MIN_PX.front, false);
  assert.equal(r.wrap, false);
  assert.ok(r.size < FIT_MIN_PX.front && r.size >= FIT_FLOOR_PX, String(r.size));
});
test('空白のある句は下限で空白折り返し・折った後に1語が幅を超えればさらに縮める', async () => {
  const { fitWrappedSize } = await import('../lib/fitWord.js');
  assert.deepEqual(fitFontSize(48, 900, 300, FIT_MIN_PX.front, true), { size: FIT_MIN_PX.front, wrap: true });
  assert.equal(fitWrappedSize(22, 280, 300), 22);
  assert.ok(fitWrappedSize(22, 330, 300) < 22);
});
