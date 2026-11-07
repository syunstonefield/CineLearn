// lib/liked.js（♡ お気に入りの例文の印）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIKE_CAP_PER_EPISODE, likedInEpisode, canLikeMore, likedWords, pickTodayWord } from '../lib/liked.js';

const mk = (word, liked, extra = {}) => ({ word, liked, sentence: `${word} line`, dramaTitle: 'Suits', season: 1, episode: 1, likedAt: '2026-11-07', ...extra });

test('1話あたりの上限は 10 件（同じ作品・同じ話だけを数える・映画は作品一致）', () => {
  const words = [...Array(LIKE_CAP_PER_EPISODE)].map((_, i) => mk(`w${i}`, true));
  assert.equal(likedInEpisode(words, { dramaTitle: 'suits', season: 1, episode: 1 }).length, 10);
  assert.equal(canLikeMore(words, { dramaTitle: 'Suits', season: 1, episode: 1 }), false);
  assert.equal(canLikeMore(words, { dramaTitle: 'Suits', season: 1, episode: 2 }), true);
  const movie = [mk('a', true, { season: null, episode: null, dramaTitle: 'Iron Man' })];
  assert.equal(likedInEpisode(movie, { dramaTitle: 'Iron Man' }).length, 1);
  assert.equal(likedInEpisode([...words, mk('x', false)], { dramaTitle: 'Suits', season: 1, episode: 1 }).length, 10);
});

test('♡の語は例文のある語だけ・新しい順', () => {
  const words = [mk('old', true, { likedAt: '2026-11-01' }), mk('new', true, { likedAt: '2026-11-07' }), mk('noex', true, { sentence: '' }), mk('off', false)];
  assert.deepEqual(likedWords(words).map((w) => w.word), ['new', 'old']);
});

test('今日の語は日付で決まり、同じ日は同じ語・♡が無ければ null', () => {
  const words = [mk('alpha', true), mk('beta', true), mk('gamma', true)];
  const a = pickTodayWord(words, '2026-11-07');
  assert.equal(pickTodayWord(words, '2026-11-07'), a);
  assert.ok(['alpha', 'beta', 'gamma'].includes(a.word));
  assert.equal(pickTodayWord([mk('x', false)], '2026-11-07'), null);
});
