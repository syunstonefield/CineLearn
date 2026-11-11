// A（ドラマの2分割・並列・2026-11-12）: 1チャンクに収まるドラマも2つに割る。splitDrama=false は従来の1回書き。映画は変わらない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supersetChunkCount, generateSuperset, CHUNK_CHARS, DRAMA_SPLIT_MIN_CHARS } from '../lib/vocab.js';

const quiet = { info() {}, warn() {}, log() {}, error() {} };

test('チャンク数: ドラマは2分割・スイッチ off は1回・映画と短い字幕は変わらない', () => {
  assert.equal(supersetChunkCount(15000, { splitDrama: true }), 2);
  assert.equal(supersetChunkCount(15000, { splitDrama: false }), 1);
  assert.equal(supersetChunkCount(15000), 1);
  assert.equal(supersetChunkCount(DRAMA_SPLIT_MIN_CHARS - 1, { splitDrama: true }), 1);
  assert.equal(supersetChunkCount(15000, { isMovie: true, splitDrama: true }), 1);
  assert.equal(supersetChunkCount(CHUNK_CHARS + 1, { isMovie: true, splitDrama: true }), 2);
  assert.equal(supersetChunkCount(CHUNK_CHARS * 2 + 1, { splitDrama: true }), 3);
});

async function run(splitDrama) {
  const calls = [];
  const callLlm = async (prompt, maxTokens, o) => {
    calls.push({ prompt, maxTokens, chunk: o.chunk, nChunks: o.nChunks });
    const drama = o.chunk === 1 ? [{ w: 'apple', l: 'A2', p: '名詞', d: 'りんご', e: 'I like the apple.', t: 'core', c: '' }]
      : [{ w: 'banana', l: 'A2', p: '名詞', d: 'バナナ', e: 'Give me the banana.', t: 'core', c: '' }];
    return JSON.stringify({ drama, plus: [{ w: 'leverage', l: 'B2', p: '名詞', d: '影響力', e: 'Leverage matters.', t: 'core', c: '' }] });
  };
  const text = 'I like the apple. '.repeat(400) + 'Give me the banana. '.repeat(400); // 約15,200字
  const words = await generateSuperset(
    { drama: { title: 'Sample Drama', type: 'tv', tmdbId: 1 }, season: 1, episode: 1, subtitleText: text, tight: true, splitDrama },
    null,
    { callLlm, log: quiet }
  );
  return { calls, words };
}

test('generateSuperset: splitDrama=true は2回（並列）・作例の語と字幕の語は回数で割る・結果は結合', async () => {
  const { calls, words } = await run(true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.nChunks), [2, 2]);
  for (const c of calls) {
    assert.match(c.prompt, /【35個を目標（最低28個・最大35個）】/);
    assert.match(c.prompt, /必ず 9〜10 語出す（10 語を超えない）/);
  }
  const ws = words.map((w) => w.word).sort();
  assert.deepEqual(ws, ['apple', 'banana', 'leverage']); // 重複の plus は1つにまとまる
});

test('generateSuperset: splitDrama=false は従来どおり1回・70語・18〜20語', async () => {
  const { calls } = await run(false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /【70個を目標（最低56個・最大70個）】/);
  assert.match(calls[0].prompt, /必ず 18〜20 語出す（20 語を超えない）/);
});
