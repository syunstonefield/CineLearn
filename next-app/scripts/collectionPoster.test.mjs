// コレクションのポスターの順番（lib/collection.js・2026-11-12 X-Men の件）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPosterUrl, posterForIdFromResults } from '../lib/collection.js';

test('ID のポスターが、保存された古い URL より優先される', () => {
  assert.equal(pickPosterUrl({ idPoster: 'id.jpg', override: 'o.jpg', stored: 'old.jpg', seasonsPoster: 's.jpg' }), 'id.jpg');
  assert.equal(pickPosterUrl({ idPoster: '', override: 'o.jpg', stored: 'old.jpg' }), 'o.jpg'); // ID の画像が無ければ従来どおり
  assert.equal(pickPosterUrl({ stored: 'old.jpg', seasonsPoster: 's.jpg' }), 'old.jpg');
  assert.equal(pickPosterUrl({}), null);
});

test('検索結果は同じ ID の縦のポスターだけ採る（題名の1番目や backdrop は使わない）', () => {
  const results = [
    { id: 246655, title: 'X-Men: Apocalypse', poster_path: '/apoc.jpg' },
    { id: 36657, title: 'X-Men', poster_path: '/xmen.jpg', backdrop_path: '/bd.jpg' },
    { id: 1, title: 'No poster', backdrop_path: '/only-bd.jpg' },
  ];
  assert.equal(posterForIdFromResults(results, 36657), 'https://image.tmdb.org/t/p/w342/xmen.jpg');
  assert.equal(posterForIdFromResults(results, 1), '');
  assert.equal(posterForIdFromResults(results, 999), '');
});
