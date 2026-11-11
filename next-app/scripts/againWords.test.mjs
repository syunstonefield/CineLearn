// 「知らなかった／うろ覚えの語をもう一度」（2026-11-12）: 語の選び方・練習扱い・最後の答えの同期のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = globalThis.window || {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { lastAnswerOf, pickAgainWords } = await import('../lib/againWords.js');
const { reviewWord, loadSrs, SRS_KEY } = await import('../lib/storage.js');
const { mergeSrs, cloudRowToEntry, localWinsPush } = await import('../lib/srsMerge.js');

test('最後の答え: lastQuality があればそれ・無ければ復習済みで repetitions=0 を「知らなかった」とみなす', () => {
  assert.equal(lastAnswerOf({ lastQuality: 0 }), 'unknown');
  assert.equal(lastAnswerOf({ lastQuality: 3 }), 'shaky');
  assert.equal(lastAnswerOf({ lastQuality: 5 }), 'known');
  assert.equal(lastAnswerOf({ lastReview: '2026-11-10', repetitions: 0 }), 'unknown');
  assert.equal(lastAnswerOf({ lastReview: '2026-11-10', repetitions: 2 }), null); // うろ覚えか知ってたかは分からない
  assert.equal(lastAnswerOf({ repetitions: 0 }), null); // 未復習
  assert.equal(lastAnswerOf({ lastQuality: 0, skipped: true }), null); // 外した語
  assert.equal(lastAnswerOf(undefined), null);
});

test('語の選び方: 種類で絞り・重複を除き・答えた時刻が新しい順・棚から外した語と今回出した語は除く', () => {
  const srs = {
    a: { lastQuality: 0, updatedAt: '2026-11-10T10:00:00Z' },
    b: { lastQuality: 0, updatedAt: '2026-11-11T09:00:00Z' },
    c: { lastQuality: 3, updatedAt: '2026-11-11T08:00:00Z' },
    d: { lastReview: '2026-11-09', repetitions: 0 }, // 推定の知らなかった（時刻は lastReview）
    e: { lastQuality: 0, updatedAt: '2026-11-11T12:00:00Z' },
  };
  const words = [{ word: 'a' }, { word: 'B' }, { word: 'a' }, { word: 'c' }, { word: 'd' }, { word: 'e' }];
  const got = pickAgainWords(words, srs, 'unknown').map((w) => w.word);
  assert.deepEqual(got, ['e', 'B', 'a', 'd']);
  assert.deepEqual(pickAgainWords(words, srs, 'shaky').map((w) => w.word), ['c']);
  const active = new Set(['a', 'b', 'd']);
  assert.deepEqual(pickAgainWords(words, srs, 'unknown', { activeKeys: active }).map((w) => w.word), ['B', 'a', 'd']);
  assert.deepEqual(pickAgainWords(words, srs, 'unknown', { exclude: new Set(['e', 'b']) }).map((w) => w.word), ['a', 'd']);
});

test('もう一度の成功は練習＝日程を進めず最後の答えだけ更新・失敗は今までどおり翌日へ', () => {
  localStorage.setItem(
    SRS_KEY,
    JSON.stringify({
      x: { interval: 1, repetitions: 0, easeFactor: 2.5, dueDate: '2000-01-02', lastReview: '2000-01-01', lastQuality: 0 },
      y: { interval: 15, repetitions: 3, easeFactor: 2.36, dueDate: '2099-01-01', lastReview: '2000-01-01', lastQuality: 3 },
    })
  );
  reviewWord('x', 5, null, { practice: true });
  let e = loadSrs().x;
  assert.equal(e.lastQuality, 5);
  assert.equal(e.repetitions, 0);
  assert.equal(e.dueDate, '2000-01-02'); // 日程はそのまま
  assert.equal(e.lastReview, '2000-01-01');
  assert.ok(e.updatedAt); // 並び（答えた時刻）と同期の決着に使う
  assert.equal(lastAnswerOf(e), 'known'); // カードから抜ける

  reviewWord('y', 0, null, { practice: true }); // 知らなかった＝日程に反映
  e = loadSrs().y;
  assert.equal(e.lastQuality, 0);
  assert.equal(e.repetitions, 0);
  assert.equal(e.interval, 1);
  assert.notEqual(e.dueDate, '2099-01-01');
});

test('同期: last_quality の行を読み、列が無い・空の行では同じ日の端末の値だけ引き継ぐ', () => {
  assert.equal(cloudRowToEntry({ word: 'w', interval: 1, repetitions: 0, ease_factor: '2.5', last_quality: 3 }).lastQuality, 3);
  assert.equal(cloudRowToEntry({ word: 'w', interval: 1, repetitions: 0, ease_factor: '2.5' }).lastQuality, undefined);

  const local = { w: { interval: 1, repetitions: 1, easeFactor: 2.5, lastReview: '2026-11-11', lastQuality: 3, updatedAt: '2026-11-11T01:00:00Z' } };
  // 同じ日・クラウドの方が新しい（別の端末）・列が無い → 端末の最後の答えを引き継ぐ
  const same = mergeSrs(local, [{ word: 'w', interval: 1, repetitions: 1, ease_factor: '2.5', last_review: '2026-11-11', updated_at: '2026-11-11T02:00:00Z' }]);
  assert.equal(same.merged.w.lastQuality, 3);
  // 違う日（クラウドが新しい）・列が無い → 古い端末の値は付けない
  const newer = mergeSrs(local, [{ word: 'w', interval: 1, repetitions: 0, ease_factor: '2.5', last_review: '2026-11-12', updated_at: '2026-11-12T02:00:00Z' }]);
  assert.equal(newer.merged.w.lastQuality, undefined);
  assert.equal(lastAnswerOf(newer.merged.w), 'unknown'); // repetitions=0 から読む
  // クラウドに値があれば採る
  const withCol = mergeSrs(local, [{ word: 'w', interval: 1, repetitions: 1, ease_factor: '2.5', last_review: '2026-11-12', updated_at: '2026-11-12T02:00:00Z', last_quality: 5 }]);
  assert.equal(withCol.merged.w.lastQuality, 5);
  // 端末が勝つ時、端末に無ければクラウドの値で埋める
  const fill = mergeSrs(
    { w: { interval: 1, repetitions: 1, easeFactor: 2.5, lastReview: '2026-11-13' } },
    [{ word: 'w', interval: 1, repetitions: 1, ease_factor: '2.5', last_review: '2026-11-12', last_quality: 3 }]
  );
  assert.equal(fill.merged.w.lastQuality, 3);
});

test('同期: 列はあるが空の行は、同じ日の端末の最後の答えを吸い上げる', () => {
  const l = { lastReview: '2026-11-11', lastQuality: 0, updatedAt: '2026-11-11T01:00:00Z' };
  assert.equal(localWinsPush(l, { last_review: '2026-11-11', last_quality: null, updated_at: '2026-11-11T01:00:00Z' }), true);
  assert.equal(localWinsPush(l, { last_review: '2026-11-11', last_quality: 0, updated_at: '2026-11-11T01:00:00Z' }), false);
  assert.equal(localWinsPush(l, { last_review: '2026-11-11', updated_at: '2026-11-11T01:00:00Z' }), false); // 列が無い DB は送らない
});
