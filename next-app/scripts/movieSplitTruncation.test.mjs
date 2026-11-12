// 2026-11-12: 映画の単語リスト。①1回に収まる映画も2つに割る ②出力が上限（max_tokens）で切れたら区間を割って作り直す・
//   割っても切れたら失敗 ③映画は終盤も見る（最後の語が字幕の終わりの 75% より前なら不合格）。
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supersetChunkCount, generateSuperset } from '../lib/vocab.js';
import { coverageOk } from '../lib/coverage.js';
const { qualityGate, MOVIE_TAIL_RATIO } = await import('../lib/server/vocabGen.js');

const quiet = { info() {}, warn() {}, log() {}, error() {} };
const movie = { title: 'Sample Movie', type: 'movie', tmdbId: 9 };

test('チャンク数: 1回に収まる映画も splitMovie で2つ・スイッチ off は1回・ドラマのスイッチとは別', () => {
  assert.equal(supersetChunkCount(25000, { isMovie: true, splitMovie: true }), 2);
  assert.equal(supersetChunkCount(25000, { isMovie: true, splitMovie: false }), 1);
  assert.equal(supersetChunkCount(25000, { isMovie: true, splitDrama: true }), 1);
  assert.equal(supersetChunkCount(25000, { isMovie: false, splitMovie: true }), 1);
  assert.equal(supersetChunkCount(5000, { isMovie: true, splitMovie: true }), 1);
  assert.equal(supersetChunkCount(60000, { isMovie: true, splitMovie: true }), 2);
});

const W = (w, e) => ({ w, l: 'B2', p: '名詞', d: `${w} の意味`, e, t: 'core', c: '' });
const text = 'I like the apple. '.repeat(800) + 'Give me the banana. '.repeat(800); // 約3万字

test('出力が上限で切れたら、その区間を2つに割って語数を半分にして作り直す（ログに「切れた（max_tokens）」）', async () => {
  const calls = [];
  const warns = [];
  let n = 0;
  const callLlm = async (prompt) => {
    n++;
    calls.push(/【(\d+)個を目標/.exec(prompt)?.[1]);
    if (n === 1) return { text: '{"drama":[{"w":"apple"', stopReason: 'max_tokens' };
    const w = prompt.includes('apple') ? W('apple', 'I like the apple.') : W('banana', 'Give me the banana.');
    return { text: JSON.stringify({ drama: [w], plus: [W('leverage', 'Leverage matters.')] }), stopReason: 'end_turn' };
  };
  const stats = { truncated: 0 };
  const words = await generateSuperset(
    { drama: movie, season: 0, episode: 0, subtitleText: text, vocabCount: 40, tight: true, splitMovie: false, stats },
    null,
    { callLlm, log: { ...quiet, warn: (m) => warns.push(String(m)) } }
  );
  assert.equal(calls.length, 3); // 1回（切れた）＋割った2回
  assert.deepEqual(calls, ['120', '60', '60']);
  assert.equal(stats.truncated, 1);
  assert.ok(warns.some((m) => m.includes('切れた（max_tokens）')));
  assert.deepEqual(words.map((w) => w.word).sort(), ['apple', 'banana', 'leverage']);
});

test('割っても切れたら生成の失敗（拾い上げで済ませない）', async () => {
  const callLlm = async () => ({ text: '{"drama":[{"w":"apple"', stopReason: 'max_tokens' });
  await assert.rejects(
    () => generateSuperset({ drama: movie, season: 0, episode: 0, subtitleText: text, vocabCount: 40, splitMovie: true }, null, { callLlm, log: quiet }),
    /max_tokens/
  );
});

test('文字列を返す callLlm（従来の差し替え）はそのまま動く', async () => {
  const callLlm = async () => JSON.stringify({ drama: [W('apple', 'I like the apple.'), W('banana', 'Give me the banana.')], plus: [] });
  const words = await generateSuperset({ drama: movie, season: 0, episode: 0, subtitleText: text, vocabCount: 40, splitMovie: true }, null, { callLlm, log: quiet });
  assert.ok(words.some((w) => w.word === 'apple'));
});

// 0〜100分の字幕（10分おき）
const ts = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')},000`;
const raw = Array.from({ length: 11 }, (_, i) => `${i + 1}\n${ts(i * 600)} --> ${ts(i * 600 + 2)}\nLine ${i}.\n`).join('\n');

test('終盤の確認: 映画は最後の語が字幕の終わりの 75% より前なら不合格・ドラマは見ない', () => {
  assert.equal(MOVIE_TAIL_RATIO, 0.75);
  const upTo = (maxMin) => Array.from({ length: 10 }, (_, i) => ({ tsSec: Math.round((i * maxMin * 60) / 9) }));
  assert.equal(coverageOk(upTo(49), raw, { tailRatio: 0.75 }), false); // Apocalypse 型（後半が無い）
  assert.equal(coverageOk(upTo(80), raw, { tailRatio: 0.75 }), true);
  assert.equal(coverageOk(upTo(49), raw), true); // 線なし（ドラマ・従来）
  const words = Array.from({ length: 25 }, (_, i) => ({ word: `w${i}`, source: 'drama', definition: 'x', example: `w${i} here`, tsSec: Math.round((i * 40 * 60) / 24) }));
  assert.equal(qualityGate(words, raw, { isMovie: true }).reason, 'coverage');
  assert.equal(qualityGate(words, raw, { isMovie: false }).reason, 'ok'); // ドラマは終盤を見ない（従来どおり）
});

test('1回の出力の上限: 思考の枠は 10,000（映画60語の区間で 9,100＋10,000＝19,100）', async () => {
  const { VOCAB_THINK_ROOM } = await import('../lib/server/constants.js');
  assert.equal(VOCAB_THINK_ROOM, 10000);
});
