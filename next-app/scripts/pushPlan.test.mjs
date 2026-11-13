// 毎日の通知の日付と「最近使っている人」（lib/server/pushPlan.js・2026-11-13）
import test from 'node:test';
import assert from 'node:assert/strict';
import { jstDate, recentSince, isRecentlyActive, wantsKind, countFromRange, shiftDate } from '../lib/server/pushPlan.js';

test('朝7時 JST の実行（22:00 UTC 前日）は日本時間の今日で比べる', () => {
  const at = new Date('2026-11-13T22:00:00Z'); // 11/14 7:00 JST
  assert.equal(at.toISOString().slice(0, 10), '2026-11-13'); // 前のコードはこれ＝日本の「きのう」
  assert.equal(jstDate(at), '2026-11-14');
  assert.equal(jstDate(new Date('2026-11-14T08:30:00Z')), '2026-11-14'); // 夕方 17:30 JST
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
});

test('夕方: 直近3日（今日・きのう・おととい）に復習か学習の記録がある人だけ', () => {
  const at = new Date('2026-11-14T08:30:00Z'); // 11/14 17:30 JST
  assert.deepEqual(recentSince(at), { day: '2026-11-12', iso: '2026-11-11T15:00:00.000Z' });
  assert.equal(isRecentlyActive({ lastReview: '2026-11-12' }, at), true);
  assert.equal(isRecentlyActive({ lastReview: '2026-11-11' }, at), false);
  assert.equal(isRecentlyActive({ lastHistoryAt: '2026-11-11T15:00:00Z' }, at), true); // 11/12 0:00 JST
  assert.equal(isRecentlyActive({ lastHistoryAt: '2026-11-11T14:59:59Z' }, at), false);
  assert.equal(isRecentlyActive({ lastReview: '2026-11-01', lastHistoryAt: '2026-11-13T12:00:00Z' }, at), true);
  assert.equal(isRecentlyActive({}, at), false);
});

test('朝／夕方の選択: 列が無い・未設定は受け取る', () => {
  assert.equal(wantsKind({}, 'morning'), true);
  assert.equal(wantsKind({ morning: null }, 'morning'), true);
  assert.equal(wantsKind({ morning: false }, 'morning'), false);
  assert.equal(wantsKind({ morning: false, evening: true }, 'evening'), true);
});

test('Content-Range から数', () => {
  assert.equal(countFromRange('0-0/839'), 839);
  assert.equal(countFromRange('*/0'), 0);
  assert.equal(countFromRange(null), 0);
});
