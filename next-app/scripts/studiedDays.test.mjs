// ホームの今日の復習の札の「学習した日」（lib/studiedDays.js）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studiedSummary, studiedLine } from '../lib/studiedDays.js';

const today = '2026-11-13';

test('学習した日＝EXP の付いた日の数（端末をまたいで合計・今日より後と 0 の日は数えない）', () => {
  const ledger = {
    '2026-11-01|dev-a': 10,
    '2026-11-01|dev-b': 5, // 同じ日の別の端末＝1日
    '2026-11-05|dev-a': 0, // EXP 0 は数えない
    '2026-11-10|dev-b': 8,
    '2026-11-20|dev-a': 4, // 先の日付（端末の時計ずれ）は数えない
  };
  assert.deepEqual(studiedSummary(ledger, today), { days: 2, today: false });
  assert.deepEqual(studiedSummary({ ...ledger, [`${today}|dev-a`]: 3 }, today), { days: 3, today: true });
  assert.deepEqual(studiedSummary({}, today), { days: 0, today: false });
  assert.deepEqual(studiedSummary(null, today), { days: 0, today: false });
});

test('文: 0日は出さない・1日目が今日の時だけ「今日が1日目」・それ以外は累計', () => {
  assert.equal(studiedLine({ days: 0, today: false }), null);
  assert.equal(studiedLine({ days: 1, today: true }), '今日が1日目');
  assert.equal(studiedLine({ days: 1, today: false }), '学習した日 1日');
  assert.equal(studiedLine({ days: 23, today: false }), '学習した日 23日');
  assert.equal(studiedLine({ days: 23, today: true }), '学習した日 23日');
  // 急がせる言い方・未達の数は出さない
  for (const s of [studiedLine({ days: 1, today: true }), studiedLine({ days: 5, today: false })]) {
    assert.ok(!/連続|あと|まだ|途切/.test(s), s);
  }
});
