// ホームの「続きから学習」の行の札（lib/continueRow.js）の単体テスト。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latestEpisode, rowEpisode, canLearn, canQuiz } from '../lib/continueRow.js';

const W = ['borrow', 'honest', 'deserve', 'afford', 'admit', 'avoid'].map((w) => ({
  word: w,
  ja: '意味',
  example: `I will ${w} it tomorrow.`,
  source: 'drama', // クイズは実セリフの例文がある語だけ（lib/prep.js isQuizEligible）
}));
const entry = { words: W };

test('行に出す話＝いちばん新しい話（最大シーズン→最大エピソード）', () => {
  assert.equal(latestEpisode([]), null);
  const e = latestEpisode([
    { season: 1, episode: 3 },
    { season: 2, episode: 1 },
    { season: 1, episode: 9 },
  ]);
  assert.deepEqual(e, { season: 2, episode: 1 });
});

test('学ぶ: 出せる語がある時だけ・全部答えて次の期日がまだなら出さない', () => {
  assert.equal(canLearn(entry, {}, '2026-11-12'), true);
  const allLater = Object.fromEntries(W.map((w) => [w.word, { repetitions: 1, interval: 6, dueDate: '2026-11-20', lastReview: '2026-11-12' }]));
  assert.equal(canLearn(entry, allLater, '2026-11-12'), false);
  assert.equal(canLearn({ words: [] }, {}, '2026-11-12'), false);
  assert.equal(canLearn(null, {}, '2026-11-12'), false);
});

test('クイズ: 問題が作れる時だけ・単語リストが無い話やマスター済みばかりの話では出さない', () => {
  assert.equal(canQuiz(entry, {}), true);
  assert.equal(canQuiz({ words: [] }, {}), false);
  // 実セリフの例文が無い語ばかり（AI の例文など）では作れない
  assert.equal(canQuiz({ words: W.map((w) => ({ ...w, source: 'ai' })) }, {}), false);
  const allMastered = Object.fromEntries(W.map((w) => [w.word, { repetitions: 4, interval: 30, easeFactor: 2.5 }]));
  assert.equal(canQuiz(entry, allMastered), false);
});

// 2026-11-18 不具合「続きから学ぶで話を変えてもホームに反映されない」: 行の話＝最後に開いた話
test('行の話: 最後に開いた話（下の話へ戻った時も・リストのある話）', () => {
  const eps = [{ season: 1, episode: 1 }, { season: 2, episode: 5 }];
  assert.deepEqual(rowEpisode(eps, { lastSeason: 1, lastEpisode: 1 }), { season: 1, episode: 1, listed: true });
});

test('行の話: 最後に開いた話にまだリストが無い時も、その話を出す（札は出さない＝listed:false）', () => {
  const eps = [{ season: 2, episode: 5 }];
  assert.deepEqual(rowEpisode(eps, { lastSeason: 2, lastEpisode: 6 }), { season: 2, episode: 6, listed: false });
});

test('行の話: 記憶が無い時は今までどおりいちばん新しい話', () => {
  const eps = [{ season: 1, episode: 3 }, { season: 2, episode: 1 }];
  assert.deepEqual(rowEpisode(eps, null), { season: 2, episode: 1, listed: true });
  assert.deepEqual(rowEpisode(eps, {}), { season: 2, episode: 1, listed: true });
  assert.equal(rowEpisode([], null), null);
});
