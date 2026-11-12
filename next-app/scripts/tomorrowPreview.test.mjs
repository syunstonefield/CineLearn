// 「明日 復習できる単語 N個」（lib/tomorrowPreview.js）のテスト・2026-11-12
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDueTomorrow, tomorrowStr } from '../lib/tomorrowPreview.js';

const now = new Date(2026, 10, 12, 23, 30); // 2026-11-12 23:30（日付の境目の近くでも地元の日付で数える）

test('明日の日付は地元の日付の次の日（月末もまたぐ）', () => {
  assert.equal(tomorrowStr(now), '2026-11-13');
  assert.equal(tomorrowStr(new Date(2026, 10, 30, 9)), '2026-12-01');
});

test('明日に期日が来る語だけ数える・6日後や外した語・マスターは数えない', () => {
  const srs = {
    fail: { dueDate: '2026-11-13', repetitions: 0, interval: 1, easeFactor: 2.3 },
    hard: { dueDate: '2026-11-13', repetitions: 1, interval: 1, easeFactor: 2.36 },
    later: { dueDate: '2026-11-18', repetitions: 2, interval: 6, easeFactor: 2.6 },
    skip: { dueDate: '2026-11-13', skipped: true, repetitions: 0, interval: 1, easeFactor: 2.5 },
    master: { dueDate: '2026-11-13', repetitions: 4, interval: 30, easeFactor: 2.5 },
  };
  const words = ['fail', 'hard', 'later', 'skip', 'master', 'Fail', 'none'].map((word) => ({ word }));
  assert.equal(countDueTomorrow(words, srs, now), 2);
});

test('練習扱いで日程が動かなかった語は、残っている期日で数える（期日が過ぎた語も明日出る）', () => {
  const srs = {
    practiced_tomorrow: { dueDate: '2026-11-13', repetitions: 0, interval: 1, easeFactor: 2.5 },
    overdue: { dueDate: '2026-11-10', repetitions: 0, interval: 1, easeFactor: 2.5 },
    practiced_later: { dueDate: '2026-11-20', repetitions: 2, interval: 8, easeFactor: 2.5 },
  };
  assert.equal(countDueTomorrow([{ word: 'practiced_tomorrow' }, { word: 'overdue' }, { word: 'practiced_later' }], srs, now), 2);
  assert.equal(countDueTomorrow([], srs, now), 0);
});
