// lib/reviewCount.js（毎日の復習の語数）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dailyReviewCap, normalizeReviewCount, reviewCountLabel, DAILY_REVIEW_CAP } from '../lib/reviewCount.js';

test('DAILY_REVIEW_CAP は lib/storage.js の値と一致（無料は1日20語）', () => {
  const src = readFileSync(new URL('../lib/storage.js', import.meta.url), 'utf8');
  const m = src.match(/export const DAILY_REVIEW_CAP = (\d+)/);
  assert.equal(Number(m[1]), DAILY_REVIEW_CAP);
  assert.equal(DAILY_REVIEW_CAP, 20);
});

test('使えない人（正式版の無料）は設定に関係なく20語', () => {
  assert.equal(dailyReviewCap({ dailyReviewCount: 50 }, false), 20);
  assert.equal(dailyReviewCap({ dailyReviewCount: 'all' }, false), 20);
  assert.equal(dailyReviewCap({}, false), 20);
});

test('使える人は設定どおり・全部は Infinity・未設定と不正値は20', () => {
  assert.equal(dailyReviewCap({ dailyReviewCount: 10 }, true), 10);
  assert.equal(dailyReviewCap({ dailyReviewCount: 30 }, true), 30);
  assert.equal(dailyReviewCap({ dailyReviewCount: 'all' }, true), Infinity);
  assert.equal(dailyReviewCap({}, true), 20);
  assert.equal(dailyReviewCap(undefined, true), 20);
  assert.equal(dailyReviewCap({ dailyReviewCount: 25 }, true), 20);
  assert.equal(dailyReviewCap({ dailyReviewCount: '30' }, true), 20);
});

test('表示ラベルと正規化', () => {
  assert.equal(reviewCountLabel('all'), '全部');
  assert.equal(reviewCountLabel(30), '30語');
  assert.equal(normalizeReviewCount(null), 20);
  assert.equal(normalizeReviewCount(50), 50);
});
