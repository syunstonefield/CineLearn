// 2026-10-20 /decide 穴①（頻出語ゲートの迂回）の単体テスト。
//   manualMatchIsExact: 活用形に頻出語が混ざる語は、手動追加では「入力したそのままの形」だけで探す。
//   拒否はしない（正規の語を巻き込まない）。迂回の語（knowed→know）は空振りする。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualMatchIsExact, manualWordProblem } from '../lib/server/commonWords.js';
import { findExampleForWord, trimExampleToSentence, exactWordRegex } from '../lib/subtitles.js';

const SRT = `1
00:00:10,000 --> 00:00:12,000
I know what you did.

2
00:00:20,000 --> 00:00:22,000
Go to bed.

3
00:00:30,000 --> 00:00:32,000
The bedding is new.

4
00:00:40,000 --> 00:00:42,000
She is happier now.

5
00:00:50,000 --> 00:00:52,000
I'm happy for you.

6
00:01:00,000 --> 00:01:02,000
We need a retainer.
`;

test('穴①: 迂回の語は拒否されないが、そのままの形でしか探さない＝頻出語の文は返らない', () => {
  for (const w of ['knowed', 'thinked', 'sayed', 'gived', 'taked']) {
    assert.equal(manualWordProblem(w), null, w); // 綴り自体は頻出語ではない
    assert.equal(manualMatchIsExact(w), true, w);
  }
  assert.equal(findExampleForWord(SRT, 'knowed', undefined, undefined, { exact: true }), null);
  // 従来の照合（exact なし）なら know の文が返ってしまう＝迂回の実在を固定
  assert.equal(findExampleForWord(SRT, 'knowed')?.sec, 10);
});

test('穴①: 正規の語（活用形に頻出語が混ざる）は、そのままの形で例文が付く', () => {
  for (const w of ['bedding', 'briefing', 'seated', 'happier', 'sayings']) {
    assert.equal(manualWordProblem(w), null, w);
    assert.equal(manualMatchIsExact(w), true, w);
  }
  assert.equal(findExampleForWord(SRT, 'bedding', undefined, undefined, { exact: true })?.sec, 30); // bed(0:20) ではない
  assert.equal(findExampleForWord(SRT, 'happier', undefined, undefined, { exact: true })?.sec, 40); // happy(0:50) ではない
});

test('穴①: 活用形に頻出語が混ざらない語は従来どおり活用形込みで探す', () => {
  for (const w of ['retainer', 'subpoena', 'witness', 'deposition']) assert.equal(manualMatchIsExact(w), false, w);
  assert.equal(findExampleForWord(SRT, 'retainer')?.sec, 60);
});

test('穴①: 例文を1文に詰める時も、そのままの形を含む文を選ぶ', () => {
  const long = `Go to bed now, it's late and you have to get up early tomorrow for the deposition at nine. ${'x '.repeat(60)}The bedding is new and clean.`;
  assert.ok(trimExampleToSentence(long, 'bedding', 200, { exact: true }).includes('bedding'));
  assert.equal(exactWordRegex(''), null);
  assert.equal(exactWordRegex('bedding').test('BEDDING'), true);
  assert.equal(exactWordRegex('bed').test('bedding'), false);
});

test('穴①: 入力語から広げた活用形が頻出語なだけの普通の語は絞らない（associate→associated 等）', () => {
  for (const w of ['associate', 'partner', 'client', 'hire', 'court', 'retainer']) assert.equal(manualMatchIsExact(w), false, w);
});

test('穴①: wordStems の原形はすべて getWordVariants に含まれる（照合器と規則が割れていない）', async () => {
  const { wordStems, getWordVariants } = await import('../lib/subtitles.js');
  for (const w of ['knowed', 'bedding', 'happier', 'sayings', 'stopped', 'tried', 'boxes', 'realised', 'knives', 'running', 'fled']) {
    const vs = getWordVariants(w);
    for (const b of wordStems(w)) assert.ok(vs.has(b), `${w} → ${b}`);
  }
});
