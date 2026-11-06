// SRS の取り込み（lib/srsMerge.js）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllSrs, mergeSrs, cloudWins, localWinsPush, cloudRowToEntry, SRS_PAGE } from '../lib/srsMerge.js';

const row = (word, last_review, extra = {}) => ({ word, interval: 6, repetitions: 2, ease_factor: '2.5', due_date: '2026-11-13', last_review, skipped: false, ...extra });

test('全件読み: 1000行ずつ末尾まで・途中で失敗したら complete:false・上限に達しても complete:false', async () => {
  const calls = [];
  const make = (n) => Array.from({ length: n }, (_, i) => row(`w${i}`, '2026-11-01'));
  const r = await fetchAllSrs(async (offset, limit) => {
    calls.push([offset, limit]);
    return offset === 0 ? make(SRS_PAGE) : make(5);
  });
  assert.equal(r.rows.length, SRS_PAGE + 5);
  assert.equal(r.complete, true);
  assert.deepEqual(calls, [[0, 1000], [1000, 1000]]);
  const bad = await fetchAllSrs(async (offset) => (offset === 0 ? make(SRS_PAGE) : null));
  assert.equal(bad.rows.length, SRS_PAGE);
  assert.equal(bad.complete, false);
  const capped = await fetchAllSrs(async () => make(10), { page: 10, max: 30 });
  assert.equal(capped.rows.length, 30);
  assert.equal(capped.complete, false);
  const empty = await fetchAllSrs(async () => []);
  assert.deepEqual(empty, { rows: [], complete: true });
});

test('どちらを採るか: 新しい日付が勝つ・同じ日は updated_at が新しい方・無ければ端末優先', () => {
  assert.equal(cloudWins(null, row('a', '2026-11-01')), true);
  assert.equal(cloudWins({ lastReview: '2026-11-01' }, row('a', '2026-11-05')), true);
  assert.equal(cloudWins({ lastReview: '2026-11-05' }, row('a', '2026-11-01')), false);
  assert.equal(cloudWins({ lastReview: '2026-11-05' }, row('a', '2026-11-05')), false); // 時刻が無い＝端末
  assert.equal(cloudWins({ lastReview: '2026-11-05', updatedAt: '2026-11-05T01:00:00Z' }, row('a', '2026-11-05', { updated_at: '2026-11-05T02:00:00Z' })), true);
  assert.equal(cloudWins({ lastReview: '2026-11-05', updatedAt: '2026-11-05T03:00:00Z' }, row('a', '2026-11-05', { updated_at: '2026-11-05T02:00:00Z' })), false);
  assert.equal(cloudWins({ lastReview: undefined }, row('a', null)), false);
});

test('吸い上げ: 端末が新しい・skipped が違う・端末だけ初回の答え・同じ日で端末の時刻が新しい', () => {
  assert.equal(localWinsPush({ lastReview: '2026-11-05' }, row('a', '2026-11-01')), true);
  assert.equal(localWinsPush({ lastReview: '2026-11-01' }, row('a', '2026-11-05')), false);
  assert.equal(localWinsPush({ lastReview: '2026-11-05', skipped: true }, row('a', '2026-11-05')), true);
  assert.equal(localWinsPush({ lastReview: '2026-11-05', firstQuality: 5 }, row('a', '2026-11-05', { first_quality: null })), true);
  assert.equal(localWinsPush({ lastReview: '2026-11-05', updatedAt: '2026-11-05T05:00:00Z' }, row('a', '2026-11-05', { updated_at: '2026-11-05T02:00:00Z' })), true);
  assert.equal(localWinsPush({ lastReview: '2026-11-05' }, row('a', '2026-11-05')), false);
  assert.equal(localWinsPush({ lastReview: '2026-11-05' }, null), true);
});

test('合算: スマホで復習した語が PC に入る（オーナー報告の再現）・途中で切れた時は吸い上げない', () => {
  // PC: 古い値（11-01 に復習・期日 11-02）。クラウド: スマホが 11-07 に復習（期日 11-13）
  const local = { trust: { interval: 1, repetitions: 1, easeFactor: 2.5, dueDate: '2026-11-02', lastReview: '2026-11-01', skipped: false }, pconly: { interval: 1, repetitions: 0, easeFactor: 2.5, lastReview: '2026-11-06', skipped: false } };
  const cloud = [row('trust', '2026-11-07', { updated_at: '2026-11-07T01:00:00Z', origin_title: 'Spider-Man: Brand New Day' }), row('phoneonly', '2026-11-07')];
  const full = mergeSrs(local, cloud, { complete: true });
  assert.equal(full.merged.trust.lastReview, '2026-11-07');
  assert.equal(full.merged.trust.dueDate, '2026-11-13');
  assert.equal(full.merged.trust.origin.title, 'Spider-Man: Brand New Day');
  assert.equal(full.merged.phoneonly.lastReview, '2026-11-07'); // スマホだけの語が PC に入る
  assert.deepEqual(Object.keys(full.pushBack), ['pconly']); // PC だけの語は全件取れた時だけ吸い上げる
  // 取り込みが途中で切れた（phoneonly が返って来ていない想定）: pconly を「クラウドに無い」と誤認して書き戻さない
  const part = mergeSrs(local, [cloud[0]], { complete: false });
  assert.equal(part.merged.trust.lastReview, '2026-11-07');
  assert.deepEqual(part.pushBack, {});
  // 旧実装の事故: 途中で切れた取り込みでも吸い上げていた＝pconly が送られ、クラウドの新しい値を潰していた（これを防ぐ）
});

test('合算: 端末優先でも出所と初回の答えは補う・クラウド優先でも端末だけの出所は引き継ぐ', () => {
  const local = { a: { lastReview: '2026-11-07', interval: 6, repetitions: 2, easeFactor: 2.5, origin: { title: 'Suits', season: 1, episode: 1 } }, b: { lastReview: '2026-11-07', interval: 1, repetitions: 1, easeFactor: 2.5 } };
  const cloud = [row('a', '2026-11-08', { updated_at: '2026-11-08T00:00:00Z' }), row('b', '2026-11-01', { origin_title: 'Friends', origin_season: 1, origin_episode: 1, first_quality: 3 })];
  const { merged, pushBack } = mergeSrs(local, cloud);
  assert.equal(merged.a.lastReview, '2026-11-08');
  assert.equal(merged.a.origin.title, 'Suits'); // クラウド行に出所が無ければ端末の出所を引き継ぐ
  assert.equal(merged.b.lastReview, '2026-11-07'); // 端末が新しい
  assert.equal(merged.b.origin.title, 'Friends'); // 出所だけ補う
  assert.equal(merged.b.firstQuality, 3);
  assert.deepEqual(Object.keys(pushBack), ['b']);
  assert.equal(cloudRowToEntry(row('x', '2026-11-01', { updated_at: '2026-11-01T00:00:00Z' })).updatedAt, '2026-11-01T00:00:00Z');
});
