// 2026-10-20 /decide G 第1段: 別の話数の字幕で作ったリスト（episode_match='fallback'）の扱い。
//   サーバ: meta.episodeMismatch を返し、配る語から📍を外す。列が無い DB では従来の列で読み直す。
//   クライアント: 出所表示から話数を外す（単語リスト・復習・クイズ・単語帳が同じ判定を使う）。
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.VOCAB_CACHE_VERSION = '2';

import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage の代用品（storage.js は window がある時だけ読む＝window も置く）
const store = new Map();
globalThis.window = globalThis.window || {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { readVocabRow, vocabRowMeta, wordsForServe } = await import('../lib/server/vocabCache.js');
const { isEpisodeMismatch, episodeCredit, subtitleCredit, HISTORY_KEY } = await import('../lib/storage.js');

test('G: wordsForServe は fallback の時だけ📍を外し、保存データは変えない', () => {
  const words = [{ word: 'a', tsSec: 10, tsLabel: '0:10' }, { word: 'b', tsSec: null, tsLabel: null }];
  const out = wordsForServe(words, 'fallback');
  assert.deepEqual(out.map((w) => [w.tsSec, w.tsLabel]), [[null, null], [null, null]]);
  assert.equal(words[0].tsSec, 10); // 元は変えない
  for (const m of ['exact', 'unknown', null, undefined]) assert.equal(wordsForServe(words, m), words);
});

test('G: vocabRowMeta の episodeMismatch は fallback の時だけ true', () => {
  assert.equal(vocabRowMeta({ episode_match: 'fallback' }).episodeMismatch, true);
  for (const m of ['exact', 'unknown', null, undefined]) assert.equal(vocabRowMeta({ episode_match: m }).episodeMismatch, false);
});

test('G: readVocabRow は episode_match 列が無い DB では従来の列で読み直す', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const sel = new URL(url).searchParams.get('select');
    seen.push(sel);
    if (/episode_match/.test(sel)) return new Response(JSON.stringify({ code: '42703', message: 'column vocab_cache.episode_match does not exist' }), { status: 400 });
    return new Response(JSON.stringify([{ words: [{ word: 'x' }], model: 'm' }]), { status: 200 });
  };
  const r = await readVocabRow('v2:tmdb1:s1e1', { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.row.words[0].word, 'x');
  assert.ok(seen.some((s) => !/episode_match/.test(s)));
});

test('G: 出所表示は、別の話数の字幕で作った回だけ話数を外す（映画・通常の回は従来どおり）', () => {
  store.set(
    HISTORY_KEY,
    JSON.stringify([
      { id: '1', drama: { title: 'Suits' }, season: 1, episode: 5, words: [], episodeMismatch: true },
      { id: '2', drama: { title: 'Suits' }, season: 1, episode: 6, words: [] },
    ])
  );
  assert.equal(isEpisodeMismatch('Suits', 1, 5), true);
  assert.equal(isEpisodeMismatch('Suits', 1, 6), false);
  assert.equal(episodeCredit('Suits', 1, 5, false), '📺 Suits（字幕：OpenSubtitles）');
  assert.equal(episodeCredit('Suits', 1, 6, false), '📺 Suits S1E6（字幕：OpenSubtitles）');
  assert.equal(episodeCredit('Iron Man', 0, 0, true), '📺 Iron Man（字幕：OpenSubtitles）');
  // 復習・クイズの経路（subtitleCredit）も同じ判定
  assert.equal(subtitleCredit({ source: 'drama', _src: { title: 'Suits', season: 1, episode: 5, type: 'tv' } }), '📺 Suits（字幕：OpenSubtitles）');
  assert.equal(subtitleCredit({ source: 'drama', _src: { title: 'Suits', season: 1, episode: 6, type: 'tv' } }), '📺 Suits S1E6（字幕：OpenSubtitles）');
  assert.equal(subtitleCredit({ source: 'plus', _src: { title: 'Suits', season: 1, episode: 5 } }), '');
});
