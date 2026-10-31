// 2026-10-31 法務 要修正1: 「この回の別の場面」は、本人の my_words に同じ作品・同じ話のその語があるときだけ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userSavedWordInEpisode } from '../lib/server/ownWord.js';

function fakeDb(rows, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
    return new Response(JSON.stringify(rows), { status });
  };
  return { calls, fetchImpl };
}
const base = { token: 'jwt-abc', uid: 'u1', word: 'mergers', tmdbId: 37680, isMovie: false, season: 1, episode: 1, title: 'Suits' };

test('同じ話に保存していれば true（作品名が同じ）・本人の JWT で読む', async () => {
  const { calls, fetchImpl } = fakeDb([{ drama_title: 'Suits', season: 1, episode: 1 }]);
  assert.equal(await userSavedWordInEpisode(base, { fetchImpl }), true);
  assert.match(calls[0].url, /my_words\?user_id=eq\.u1&word=ilike\.mergers/);
  assert.equal(calls[0].auth, 'Bearer jwt-abc');
});

test('作品名が邦題でも TMDB ID が一致すれば true', async () => {
  const { fetchImpl } = fakeDb([{ drama_title: 'SUITS/スーツ', season: 1, episode: 1 }]);
  const resolve = async (t) => (t === 'SUITS/スーツ' ? 37680 : null);
  assert.equal(await userSavedWordInEpisode(base, { fetchImpl, resolve }), true);
});

test('別の話・別の作品・保存なし・取得失敗は false', async () => {
  assert.equal(await userSavedWordInEpisode(base, { fetchImpl: fakeDb([{ drama_title: 'Suits', season: 1, episode: 2 }]).fetchImpl }), false);
  assert.equal(
    await userSavedWordInEpisode(base, { fetchImpl: fakeDb([{ drama_title: 'Billions', season: 1, episode: 1 }]).fetchImpl, resolve: async () => 62852 }),
    false
  );
  assert.equal(await userSavedWordInEpisode(base, { fetchImpl: fakeDb([]).fetchImpl }), false);
  assert.equal(await userSavedWordInEpisode(base, { fetchImpl: fakeDb({ message: 'x' }, { status: 500 }).fetchImpl }), false);
});

test('トークン無し・ワイルドカードを含む語は照会せず false', async () => {
  const { calls, fetchImpl } = fakeDb([{ drama_title: 'Suits', season: 1, episode: 1 }]);
  assert.equal(await userSavedWordInEpisode({ ...base, token: '' }, { fetchImpl }), false);
  assert.equal(await userSavedWordInEpisode({ ...base, word: 'merg%' }, { fetchImpl }), false);
  assert.equal(calls.length, 0);
});

test('映画は話数の無い行だけ一致', async () => {
  const movie = { ...base, isMovie: true, season: 0, episode: 0, title: 'Inception' };
  assert.equal(await userSavedWordInEpisode(movie, { fetchImpl: fakeDb([{ drama_title: 'Inception', season: null, episode: null }]).fetchImpl }), true);
  assert.equal(await userSavedWordInEpisode(movie, { fetchImpl: fakeDb([{ drama_title: 'Inception', season: 1, episode: 1 }]).fetchImpl }), false);
});
