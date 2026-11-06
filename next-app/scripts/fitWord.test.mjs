// 復習カードの大きな語の大きさ（lib/fitWord.js）のテスト・2026-11-07（オーナー訂正後）
//   句は空白で折り返してよい。縮めるのは、いちばん長い1語が幅に入らない時だけ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitLongestWord, FIT_FLOOR_PX } from '../lib/fitWord.js';

test('いちばん長い語が入るなら縮めない（句が2行になっても構わない）', () => {
  assert.equal(fitLongestWord(48, 250, 300), 48);
  assert.equal(fitLongestWord(48, 300, 300), 48);
});
test('1語が入らない時だけ、その語が入る大きさまで縮める（少しゆとりを残す）', () => {
  const s = fitLongestWord(48, 400, 300);
  assert.ok(s <= 36 && s >= 34, String(s));
});
test('極端に長い1語でも最小の大きさより小さくしない', () => {
  assert.equal(fitLongestWord(48, 5000, 300), FIT_FLOOR_PX);
});
test('測れない時は何もしない', () => {
  assert.equal(fitLongestWord(48, 0, 300), 48);
  assert.equal(fitLongestWord(48, 400, 0), 48);
});
