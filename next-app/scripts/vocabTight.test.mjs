// A'（書きすぎを止める・2026-11-12）: 字幕の語の上限・作例の語の分割・max_tokens の天井。tight=false は従来と同じ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVocabPrompt, plusRangeFor, supersetMaxTokens, generateSuperset } from '../lib/vocab.js';

const drama = { title: 'Sample Drama', type: 'tv', tmdbId: 1 };
const base = { drama, season: 1, episode: 1, subtitleText: 'We need to talk.', mode: 'superset', cur: 0, upper: 0, genVocabCount: 70, minTotal: 50 };

test('作例の語の数: 分割の回数で割る（合計は 18〜20 のまま）', () => {
  assert.deepEqual(plusRangeFor(1), [18, 20]);
  assert.deepEqual(plusRangeFor(2), [9, 10]);
  assert.deepEqual(plusRangeFor(3), [6, 7]);
  assert.deepEqual(plusRangeFor(0), [18, 20]);
});

test('max_tokens: tight=false は従来の式のまま／tight は語数ベースで締める', () => {
  assert.equal(supersetMaxTokens(70), Math.min(13000, (70 + 25) * 140));
  assert.equal(supersetMaxTokens(60), Math.min(13000, (60 + 25) * 140));
  assert.equal(supersetMaxTokens(70, { tight: true }), (70 + 20) * 130);
  assert.equal(supersetMaxTokens(60, { tight: true, quotaDiv: 2 }), (60 + 10) * 130);
  assert.ok(supersetMaxTokens(60, { tight: true, quotaDiv: 2 }) < supersetMaxTokens(60));
});

test('文面: tight=false は従来の「出し切る」「18〜20 語」のまま', () => {
  const { prompt, maxTokens } = buildVocabPrompt(base);
  assert.match(prompt, /【70個を目標・最低56個】/);
  assert.match(prompt, /目標数まで出し切ること（少なく切り上げない）/);
  assert.match(prompt, /plus（字幕外の推奨語）は必ず 18〜20 語出す。この作品/);
  assert.doesNotMatch(prompt, /超えて出さない|語を超えない/);
  assert.equal(maxTokens, 13000);
});

test('文面: tight は上限つき（目標と下限は残す）・作例の語は回数で割る', () => {
  const one = buildVocabPrompt({ ...base, tight: true });
  assert.match(one.prompt, /【70個を目標（最低56個・最大70個）】/);
  assert.match(one.prompt, /70個を超えて出さないこと/);
  assert.doesNotMatch(one.prompt, /出し切ること/);
  assert.match(one.prompt, /必ず 18〜20 語出す（20 語を超えない）/);
  const two = buildVocabPrompt({ ...base, genVocabCount: 60, tight: true, quotaDiv: 2 });
  assert.match(two.prompt, /必ず 9〜10 語出す（10 語を超えない）/);
  assert.equal(two.maxTokens, 9100);
});

test('generateSuperset: tight が各チャンクの呼び出しに届く（2分割の映画）', async () => {
  const calls = [];
  const callLlm = async (prompt, maxTokens) => {
    calls.push({ maxTokens, plus: /必ず 9〜10 語/.test(prompt), cap: /超えて出さない/.test(prompt) });
    return JSON.stringify({ drama: [], plus: [{ w: 'leverage', l: 'B2', p: '名詞', d: '影響力', e: 'Leverage matters.', t: 'core', c: '' }] });
  };
  const movie = { title: 'Sample Movie', type: 'movie', tmdbId: 2 };
  const text = 'We need to talk about the plan. '.repeat(3000); // 約96,000字 → 3分割
  await generateSuperset({ drama: movie, season: 0, episode: 0, subtitleText: text, vocabCount: 40, tight: true }, null, {
    callLlm,
    log: { info() {}, warn() {}, log() {}, error() {} },
  }).catch(() => {}); // drama 0語の扱いはこのテストの対象外（呼び出しの中身だけ見る）
  assert.ok(calls.length >= 3);
  for (const c of calls.slice(0, 3)) {
    assert.equal(c.cap, true);
  }
  assert.ok(calls.every((c) => c.maxTokens <= 13000));
});
