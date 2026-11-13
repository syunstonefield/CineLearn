// ホームの「昨日の語」（lib/yesterdayWord.js）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yesterdayOf, yesterdayCandidates, pickYesterdayWord } from '../lib/yesterdayWord.js';

const today = '2026-11-14';
const history = [
  {
    drama: { title: 'Sample Drama' },
    season: 1,
    episode: 2,
    words: [
      { word: 'borrow', ja: '借りる', example: 'Can I borrow it?', source: 'drama' },
      { word: 'honest', ja: '正直な', example: 'Be honest.', source: 'drama' },
      { word: 'eager', ja: '熱心な', example: 'She is eager.', source: 'plus' }, // AI の作例＝出さない
      { word: 'admit', ja: '認める', example: '', source: 'drama' }, // 例文なし
      { word: 'delay', ja: '遅らせる', example: 'No delay.', source: 'drama' },
    ],
  },
];
const srs = {
  borrow: { lastReview: '2026-11-13' },
  honest: { lastReview: '2026-11-13' },
  eager: { lastReview: '2026-11-13' },
  admit: { lastReview: '2026-11-13' },
  delay: { lastReview: '2026-11-12' }, // 一昨日＝出さない
};

test('昨日の日付（月またぎ・年またぎ）', () => {
  assert.equal(yesterdayOf('2026-11-14'), '2026-11-13');
  assert.equal(yesterdayOf('2026-12-01'), '2026-11-30');
  assert.equal(yesterdayOf('2027-01-01'), '2026-12-31');
  assert.equal(yesterdayOf(''), '');
});

test('候補＝昨日学んだ語で、OpenSubtitles の例文がある語だけ（AI の作例・例文なし・一昨日の語は出さない）', () => {
  const words = yesterdayCandidates(history, srs, today).map((w) => w.word);
  assert.deepEqual(words, ['borrow', 'honest']);
  const c = yesterdayCandidates(history, srs, today)[0];
  assert.equal(c.drama.title, 'Sample Drama');
  assert.equal(c.season, 1);
  assert.equal(c.episode, 2);
});

test('1日に1つ・同じ日は同じ語・昨日学んでいなければ null', () => {
  const a = pickYesterdayWord(history, srs, today);
  const b = pickYesterdayWord(history, srs, today);
  assert.ok(a && ['borrow', 'honest'].includes(a.word));
  assert.equal(a.word, b.word);
  assert.equal(pickYesterdayWord(history, srs, '2026-11-20'), null);
  assert.equal(pickYesterdayWord([], {}, today), null);
});
