// 初めて復習する語の1日の上限（lib/storage.js setNewWordDailyCap）のテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDueReviewWords, setNewWordDailyCap, newWordsStartedToday, todayStr } from '../lib/storage.js';

const hist = (n) => [{ id: '1', date: '2026-10-01', drama: { title: 'T' }, season: 1, episode: 1, words: Array.from({ length: n }, (_, i) => ({ word: `w${i}` })) }];

test('上限なし（プラス・ベータ）は未学習を全部出す', () => {
  setNewWordDailyCap(null);
  assert.equal(getDueReviewWords(hist(30), {}, [], null).length, 30);
});

test('上限20: 未学習は残り枠だけ・期日の来た語は上限に数えない', () => {
  const today = todayStr();
  const srs = {
    w0: { interval: 1, repetitions: 1, easeFactor: 2.5, dueDate: '2000-01-01', lastReview: '2000-01-01' }, // 期日到来
  };
  for (let i = 1; i <= 5; i++) srs[`w${i}`] = { interval: 1, repetitions: 1, easeFactor: 2.5, dueDate: '2999-01-01', firstReview: today };
  assert.equal(newWordsStartedToday(srs), 5);
  setNewWordDailyCap(20);
  const out = getDueReviewWords(hist(40), srs, [], null);
  const fresh = out.filter((w) => !srs[w.word]);
  assert.equal(fresh.length, 15); // 20 - 今日すでに始めた5
  assert.ok(out.some((w) => w.word === 'w0')); // 期日の来た語は出る
  setNewWordDailyCap(null);
});
