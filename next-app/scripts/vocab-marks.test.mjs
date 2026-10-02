// /api/vocab-marks（字幕マーカー用の語リスト）と lib/server/tmdbResolve.js の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordStrings } from '../lib/server/vocabCache.js';
import { titleQueryCandidates, pickTmdbCandidate, normTitle } from '../lib/server/tmdbResolve.js';

test('wordStrings: 旧形式(word)と短縮形(w)の両方から小文字の語だけを重複なく取り出す', () => {
  const words = [
    { word: 'Afford', definition: 'x' },
    { w: 'reckless', l: 'B2' },
    { w: 'afford' },
    { w: '' },
    null,
    { definition: 'no word' },
  ];
  assert.deepEqual(wordStrings(words), ['afford', 'reckless']);
  assert.deepEqual(wordStrings(null), []);
});

test('titleQueryCandidates: 区切り付きタイトルを空白化・分割した候補を重複なく返す', () => {
  const c = titleQueryCandidates('スター・ウォーズ／シスの復讐');
  assert.equal(c[0], 'スター・ウォーズ／シスの復讐');
  assert.ok(c.includes('スター・ウォーズ シスの復讐'));
  assert.ok(c.includes('シスの復讐'));
  assert.deepEqual(titleQueryCandidates('  '), []);
});

test('pickTmdbCandidate: 正規化一致のみ採用し、同点は人気度で決める。一致なしは null', () => {
  const results = [
    { id: 1, media_type: 'tv', name: 'Suits LA', popularity: 50 },
    { id: 2, media_type: 'tv', name: 'SUITS', original_name: 'Suits', popularity: 90 },
    { id: 3, media_type: 'movie', title: 'Suits', popularity: 999 },
  ];
  assert.equal(pickTmdbCandidate(results, 'suits', false), 2);
  assert.equal(pickTmdbCandidate(results, 'suits', true), 3);
  assert.equal(pickTmdbCandidate(results, 'friends', false), null);
  assert.equal(normTitle('Iron Man: Rise!'), 'ironmanrise');
});
