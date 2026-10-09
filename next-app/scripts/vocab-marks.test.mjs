// /api/vocab-marks（字幕マーカー用の語リスト）と lib/server/tmdbResolve.js の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordStrings, wordMeanings } from '../lib/server/vocabCache.js';
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

test('wordMeanings: 語・意味・品詞だけ（例文は含めない）、意味なしは語のみ', () => {
  const words = [
    { w: 'afford', d: '〜する余裕がある', p: '動詞', e: 'secret example', l: 'B2' },
    { word: 'Deal', definition: '取引', pos: '名詞', example: 'secret' },
    { w: 'bare' },
    { w: 'afford', d: 'dup' },
  ];
  const out = wordMeanings(words);
  assert.deepEqual(out, [
    { w: 'afford', d: '〜する余裕がある', p: '動詞' },
    { w: 'deal', d: '取引', p: '名詞' },
    { w: 'bare' },
  ]);
  assert.ok(!JSON.stringify(out).includes('secret'));
});

test('Disney+ 表記「ホワット・イフ...？」が TMDB の「ホワット・イフ…?」に当たる（三点リーダ・全角？）', () => {
  assert.equal(normTitle('ホワット・イフ...？'), normTitle('ホワット・イフ…?'));
  assert.equal(normTitle('What If...?'), 'whatif');
  const c = titleQueryCandidates('ホワット・イフ...？');
  assert.ok(c.includes('ホワット・イフ…?'));
  const results = [{ id: 91363, media_type: 'tv', name: 'ホワット・イフ…?', original_name: 'What If...?', popularity: 80 }];
  assert.equal(pickTmdbCandidate(results, 'ホワット・イフ...？', false), 91363);
});
