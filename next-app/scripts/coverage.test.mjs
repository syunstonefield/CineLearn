// lib/coverage.js（時間カバレッジ判定）の単体テスト。
//   node --import ../seed/register-hooks.mjs --test 'scripts/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageOk, srtTotalSec } from '../lib/coverage.js';

// 総尺 totalSec の生 SRT を組む（最終タイムコードだけが判定に効く）。
function srtOf(totalSec) {
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `1\n00:00:01,000 --> 00:00:03,000\nHello there.\n\n2\n${hh}:${mm}:${ss},000 --> ${hh}:${mm}:${ss},900\nBye.\n`;
}
const wordsAt = (secs) => secs.map((s, i) => ({ word: `w${i}`, tsSec: s }));

test('srtTotalSec は最終タイムコードの時:分:秒を秒で返す', () => {
  assert.equal(srtTotalSec(srtOf(7200)), 7200);
  assert.equal(srtTotalSec(srtOf(65)), 65);
  assert.equal(srtTotalSec(''), null);
  assert.equal(srtTotalSec('no timestamps here'), null);
});

test('全編に散っていれば true', () => {
  assert.equal(coverageOk(wordsAt([30, 600, 1500, 2400, 3300, 4200, 5100, 6000]), srtOf(6300)), true);
});

test('序盤（総尺の25%以内）に語が無ければ false', () => {
  // 総尺 6000s の 25% = 1500s。最初の語が 1800s → 前半チャンク欠落の疑い
  assert.equal(coverageOk(wordsAt([1800, 2400, 3000, 3600, 4200, 4800]), srtOf(6000)), false);
});

test('30分（1800s）超の空白があれば false', () => {
  assert.equal(coverageOk(wordsAt([10, 100, 200, 300, 2200, 2300]), srtOf(2400)), false);
});

test('判定材料が無い（📍5未満・raw なし・タイムコード無し・10分未満）ときは true＝寄与を止めない', () => {
  assert.equal(coverageOk(wordsAt([1800, 1900, 2000, 2100]), srtOf(6000)), true); // 4語
  assert.equal(coverageOk(wordsAt([1800, 1900, 2000, 2100, 2200]), ''), true); // raw なし
  assert.equal(coverageOk(wordsAt([1800, 1900, 2000, 2100, 2200]), 'no stamps'), true);
  assert.equal(coverageOk(wordsAt([500, 510, 520, 530, 540]), srtOf(590)), true); // 10分未満
});

test('tsSec が null/非数の語は無視する（plus 語）', () => {
  const words = [...wordsAt([30, 600, 1200, 1800, 2400]), { word: 'plus1', tsSec: null }, { word: 'plus2' }];
  assert.equal(coverageOk(words, srtOf(2700)), true);
});
