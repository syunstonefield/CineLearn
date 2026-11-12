// 2026-11-12: ホームのポスター取り直しが作品の ID を別の作品の ID で上書きしていた件（X-Men 映画 36657 → ドラマ 4574）。
//   単語リストの画面は、保存された ID が題名の検索結果に入っている時だけ使い、入っていなければ題名の完全一致で探し直す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyKnownCandidate, fetchTitleCandidatesFromTMDb, sameTitle, knownTitleCandidate } from '../lib/tmdb.js';

function mockTmdb(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return { json: async () => handler(body) };
  };
  return calls;
}

const MOVIES_XMEN = [
  { id: 246655, title: 'X-Men: Apocalypse', original_title: 'X-Men: Apocalypse' },
  { id: 36657, title: 'X-Men', original_title: 'X-Men' },
];

test('verifyKnownCandidate: 題名の検索結果に ID があれば使う・無ければ null（映画は映画で検索）', async () => {
  const calls = mockTmdb((b) => ({ results: b.action === 'search_movie' ? MOVIES_XMEN : [{ id: 4574, name: 'X-Men' }] }));
  const ok = knownTitleCandidate({ title: 'X-Men', englishTitle: 'X-Men', tmdbId: 36657, mediaType: 'movie' });
  assert.equal((await verifyKnownCandidate(ok, 'X-Men')).tmdbId, 36657);
  assert.equal(calls[0].action, 'search_movie');
  const broken = knownTitleCandidate({ title: 'X-Men', englishTitle: 'X-Men', tmdbId: 4574, mediaType: 'movie' });
  assert.equal(await verifyKnownCandidate(broken, 'X-Men'), null);
  assert.equal(await verifyKnownCandidate(null, 'X-Men'), null);
});

test('verifyKnownCandidate: 通信に失敗したら候補のまま（開けなくしない）', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  const c = knownTitleCandidate({ title: 'Loki', tmdbId: 84958, mediaType: 'tv' });
  assert.equal(await verifyKnownCandidate(c, 'Loki'), c);
});

test('fetchTitleCandidatesFromTMDb: 題名が完全に一致する作品を1番目より優先（X-Men → 36657）', async () => {
  mockTmdb(() => ({
    results: [
      { media_type: 'movie', ...MOVIES_XMEN[0] },
      { media_type: 'tv', id: 4574, name: 'X-メン', original_name: 'X-Men' },
      { media_type: 'movie', ...MOVIES_XMEN[1] },
    ],
  }));
  const c = await fetchTitleCandidatesFromTMDb('X-Men');
  assert.equal(c.movie.tmdbId, 36657);
  assert.equal(c.tv.tmdbId, 4574);
  // 一致が無ければ従来どおり1番目
  const d = await fetchTitleCandidatesFromTMDb('X-Men Saga');
  assert.equal(d.movie.tmdbId, 246655);
});

test('sameTitle: 大文字小文字・記号・空白の違いは同じ', () => {
  assert.ok(sameTitle({ title: 'Spider-Man: Homecoming' }, 'spider man homecoming'));
  assert.ok(sameTitle({ original_name: 'X-Men' }, 'X-MEN'));
  assert.ok(!sameTitle({ title: 'X-Men: Apocalypse' }, 'X-Men'));
});

test('verifyKnownCandidate: 一覧の題名で確かめる（英題が上書きされていても）・題名が完全一致する作品があれば ID はその中に限る', async () => {
  const movies = [
    { id: 246655, title: 'X-Men: Apocalypse', original_title: 'X-Men: Apocalypse', poster_path: '/apoc.jpg' },
    { id: 36657, title: 'X-Men', original_title: 'X-Men', poster_path: '/xmen.jpg' },
  ];
  const calls = mockTmdb(() => ({ results: movies }));
  // オーナーの端末の一覧: 題名は X-Men・英題と ID はアポカリプスに上書き済み → 合わない（題名で探し直す）
  const owner = knownTitleCandidate({ title: 'X-Men', englishTitle: 'X-Men: Apocalypse', tmdbId: 246655, mediaType: 'movie', posterPath: '/apoc-old.jpg' });
  assert.equal(await verifyKnownCandidate(owner, 'X-Men'), null);
  assert.equal(calls.at(-1).query, 'X-Men');
  // 正しい一覧は通り、ポスターはその ID の結果のものに付け直す
  const good = knownTitleCandidate({ title: 'X-Men', englishTitle: 'X-Men', tmdbId: 36657, mediaType: 'movie', posterPath: '/apoc-old.jpg' });
  const v = await verifyKnownCandidate(good, 'X-Men');
  assert.equal(v.tmdbId, 36657);
  assert.equal(v.posterPath, 'https://image.tmdb.org/t/p/w342/xmen.jpg');
  // アポカリプスそのものの一覧は通る
  const apoc = knownTitleCandidate({ title: 'X-Men: Apocalypse', tmdbId: 246655, mediaType: 'movie' });
  assert.equal((await verifyKnownCandidate(apoc, 'X-Men: Apocalypse')).tmdbId, 246655);
  // 邦題の古い一覧（英語の結果に完全一致が無い）は、ID が結果にあれば通る
  const ja = knownTitleCandidate({ title: 'X-MEN：アポカリプス', tmdbId: 246655, mediaType: 'movie' });
  assert.equal((await verifyKnownCandidate(ja, 'X-MEN：アポカリプス')).tmdbId, 246655);
});
