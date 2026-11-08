// user_state に 2026-11-05 に足した3項目の合算規則（lib/stateMergeRules.js）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeActivityDates, mergeReviewLog, mergeQuizAwarded, ACTIVITY_MAX, REVIEW_LOG_MAX } from '../lib/stateMergeRules.js';

test('学習した日: 和集合・昇順・不正な値は捨てる・上限', () => {
  assert.deepEqual(mergeActivityDates(['2026-11-03', '2026-11-05'], ['2026-11-04', '2026-11-03']), ['2026-11-03', '2026-11-04', '2026-11-05']);
  assert.deepEqual(mergeActivityDates(null, ['2026-11-01']), ['2026-11-01']);
  assert.deepEqual(mergeActivityDates(['2026/11/01', 5, '2026-11-02'], undefined), ['2026-11-02']);
  const many = Array.from({ length: ACTIVITY_MAX + 10 }, (_, i) => `2025-01-${String((i % 28) + 1).padStart(2, '0')}`);
  assert.ok(mergeActivityDates(many, []).length <= ACTIVITY_MAX);
  // 入り直し: 端末が空（消去後）でもクラウドの分が戻る＝連続日数が減らない
  assert.deepEqual(mergeActivityDates([], ['2026-11-01', '2026-11-02']), ['2026-11-01', '2026-11-02']);
});

test('復習の記録: 同じセッションは1件・日付順・上限', () => {
  const a = { date: '2026-11-05', historyId: 'h1', sessionNum: 1, easy: 3, hard: 1, fail: 0, total: 4 };
  const a2 = { ...a, easy: 4, total: 5 }; // ローカルが後勝ち
  const b = { date: '2026-11-04', historyId: 'h1', sessionNum: 1, easy: 1, hard: 0, fail: 0, total: 1 };
  const m = mergeReviewLog([a2], [a, b, { bad: true }]);
  assert.deepEqual(m, [b, a2]);
  const many = Array.from({ length: REVIEW_LOG_MAX + 5 }, (_, i) => ({ date: '2026-01-01', historyId: 'h', sessionNum: i + 1 }));
  assert.equal(mergeReviewLog(many, []).length, REVIEW_LOG_MAX);
});

test('クイズ EXP の台帳: historyId ごとの語の和集合（小文字）・二重付与を防ぐ側に', () => {
  const m = mergeQuizAwarded({ h1: ['Trust', 'ruin'], h2: ['x'] }, { h1: ['trust', 'shift'], h3: ['y'] });
  assert.deepEqual(m.h1.sort(), ['ruin', 'shift', 'trust']);
  assert.deepEqual(m.h2, ['x']);
  assert.deepEqual(m.h3, ['y']);
  assert.deepEqual(mergeQuizAwarded(null, ['not-an-object']), {});
});
