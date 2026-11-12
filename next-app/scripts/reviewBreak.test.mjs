// 10枚でひと区切り（lib/reviewBreak.js）のテスト・2026-11-12
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowBreak } from '../lib/reviewBreak.js';

test('10・20…枚目を答えた後に出す・最後の1枚の後は出さない', () => {
  assert.equal(shouldShowBreak(10, 20, true), true);
  assert.equal(shouldShowBreak(20, 30, true), true);
  assert.equal(shouldShowBreak(9, 20, true), false);
  assert.equal(shouldShowBreak(11, 20, true), false);
  assert.equal(shouldShowBreak(20, 20, true), false); // 最後の1枚＝完了画面へ
  assert.equal(shouldShowBreak(10, 10, true), false);
  assert.equal(shouldShowBreak(0, 20, true), false);
});

test('設定が切なら出さない・戻るで答え直した所では二度出さない', () => {
  assert.equal(shouldShowBreak(10, 20, false), false);
  const shown = new Set([10]);
  assert.equal(shouldShowBreak(10, 30, true, shown), false);
  assert.equal(shouldShowBreak(20, 30, true, shown), true);
});
