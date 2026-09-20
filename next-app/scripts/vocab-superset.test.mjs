// lib/vocab.js generateSuperset の単体テスト（モック LLM 注入）。1チャンク／3チャンクの結合規則・並列・deadline・deps 必須。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSuperset } from '../lib/vocab.js';

const silentLog = { info() {}, warn() {}, log() {}, error() {} };
const drama = { title: 'Suits', type: 'movie', tmdbId: 1 };

// 短キー形式の LLM 応答を組む
const W = (w, e, extra = {}) => ({ w, l: 'B2', p: '名詞', d: `${w} の意味`, e, t: 'core', c: '', ...extra });
const reply = (dramaWords, plusWords = []) => JSON.stringify({ drama: dramaWords, plus: plusWords });

// ちょうど len 文字のブロックを作る（チャンク境界を部（A/B/C）の境界に揃えるため）。
function block(sentences, len) {
  let s = sentences.join(' ');
  const filler = 'The meeting starts at nine. ';
  while (s.length < len) s += filler;
  return s.slice(0, len);
}

test('deps.callLlm が無ければ throw（LLM 呼び出しは注入必須）', async () => {
  await assert.rejects(() => generateSuperset({ drama, season: 0, episode: 0, subtitleText: 'short text' }), /callLlm/);
  await assert.rejects(() => generateSuperset({ drama, season: 0, episode: 0, subtitleText: 'short text' }, null, {}), /callLlm/);
});

test('1チャンク: callLlm は1回・nChunks=1・deadlineAt がそのまま渡る。drama は字幕実在で確定・plus は残る', async () => {
  const calls = [];
  const subtitleText = 'They served a subpoena on Monday. The meeting starts at nine. We must negotiate the terms.';
  const deadlineAt = Date.now() + 100_000;
  const callLlm = async (prompt, maxTokens, o) => {
    calls.push({ promptLen: prompt.length, maxTokens, o });
    return reply(
      [W('subpoena', 'They served a subpoena on Monday.'), W('fabricated', 'This word is not in the subtitle.')],
      [W('liquidity', 'Liquidity matters.')]
    );
  };
  const out = await generateSuperset({ drama, season: 0, episode: 0, subtitleText, vocabCount: 40, deadlineAt }, null, { callLlm, log: silentLog });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].o.nChunks, 1);
  assert.equal(calls[0].o.chunk, 1);
  assert.equal(calls[0].o.deadlineAt, deadlineAt);
  assert.ok(calls[0].promptLen > subtitleText.length);
  assert.ok(calls[0].maxTokens > 0 && calls[0].maxTokens <= 13000);
  const byWord = Object.fromEntries(out.map((w) => [w.word, w]));
  assert.equal(byWord.subpoena.source, 'drama');
  assert.equal(byWord.fabricated, undefined); // 字幕に無い drama 語は除外（水増し排除）
  assert.equal(byWord.liquidity.source, 'plus');
  assert.equal(byWord.subpoena.definition, 'subpoena の意味');
});

test('3チャンク: 並列に3回呼び、結合は先着優先・plus→drama 昇格・最後に全編で再確定', async () => {
  const LEN = 34_000;
  const A = block(['The meeting starts at nine.'], LEN); // leverage を含まない
  const B = block(['We can leverage the data.'], LEN);
  const C = block(['They served a subpoena.'], LEN);
  const subtitleText = A + B + C; // 102,000 字 → ceil(102000/45000)=3 チャンク・size=34,000 で部境界と一致
  const started = [];
  const resolvers = [];
  const progress = [];
  const callLlm = (prompt, maxTokens, o) =>
    new Promise((resolve) => {
      started.push(o.chunk);
      resolvers.push(() => {
        if (o.chunk === 1) resolve(reply([W('meeting', 'The meeting starts at nine.')], [W('leverage', 'Leverage is key to growth.')]));
        else if (o.chunk === 2) resolve(reply([W('leverage', 'We can leverage the data.')]));
        else resolve(reply([W('subpoena', 'They served a subpoena.')], [W('meeting', 'A meeting was held.')]));
      });
    });
  const p = generateSuperset(
    { drama, season: 0, episode: 0, subtitleText, vocabCount: 40, deadlineAt: Date.now() + 200_000, onProgress: (d, n) => progress.push([d, n]) },
    null,
    { callLlm, log: silentLog }
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual([...started].sort(), [1, 2, 3]); // 3つとも同時に開始している＝並列
  resolvers.forEach((r) => r());
  const out = await p;
  assert.equal(started.length, 3);
  assert.deepEqual(progress.map(([d]) => d).sort(), [1, 2, 3]);
  assert.deepEqual(progress[progress.length - 1], [3, 3]);
  const byWord = Object.fromEntries(out.map((w) => [w.word, w]));
  assert.equal(out.filter((w) => w.word === 'meeting').length, 1); // 重複排除（先着＝chunk1 の drama）
  assert.equal(byWord.meeting.source, 'drama');
  assert.equal(byWord.leverage.source, 'drama'); // chunk1 の plus が chunk2 の drama に置き換わる
  assert.equal(byWord.leverage.example, 'We can leverage the data.');
  assert.equal(byWord.subpoena.source, 'drama');
});

test('0語チャンクは残予算 ≥60s のとき1回だけ引き直す。予算不足なら引き直さず失敗', async () => {
  const LEN = 34_000;
  const subtitleText = block(['The meeting starts at nine.'], LEN) + block(['We can leverage the data.'], LEN) + block(['They served a subpoena.'], LEN);
  const mk = (failSecondChunkTimes) => {
    let secondCalls = 0;
    const calls = [];
    const callLlm = async (prompt, maxTokens, o) => {
      calls.push(o.chunk);
      if (o.chunk === 2 && secondCalls++ < failSecondChunkTimes) return 'Sorry, I cannot help with that.'; // 0語
      if (o.chunk === 1) return reply([W('meeting', 'The meeting starts at nine.')]);
      if (o.chunk === 2) return reply([W('leverage', 'We can leverage the data.')]);
      return reply([W('subpoena', 'They served a subpoena.')]);
    };
    return { callLlm, calls };
  };
  // 予算十分 → 引き直して成功（呼び出し4回）
  {
    const { callLlm, calls } = mk(1);
    const out = await generateSuperset({ drama, season: 0, episode: 0, subtitleText, deadlineAt: Date.now() + 120_000 }, null, { callLlm, log: silentLog });
    assert.equal(calls.filter((c) => c === 2).length, 2);
    assert.equal(calls.length, 4);
    assert.ok(out.some((w) => w.word === 'leverage'));
  }
  // 引き直しても0語 → 失敗（plain Error・「0語」を含む）
  {
    const { callLlm, calls } = mk(2);
    await assert.rejects(
      () => generateSuperset({ drama, season: 0, episode: 0, subtitleText, deadlineAt: Date.now() + 120_000 }, null, { callLlm, log: silentLog }),
      /0語/
    );
    assert.equal(calls.filter((c) => c === 2).length, 2);
  }
  // 残予算 30s → 引き直さない（chunk2 は1回だけ）
  {
    const { callLlm, calls } = mk(1);
    await assert.rejects(
      () => generateSuperset({ drama, season: 0, episode: 0, subtitleText, deadlineAt: Date.now() + 30_000 }, null, { callLlm, log: silentLog }),
      /0語/
    );
    assert.equal(calls.filter((c) => c === 2).length, 1);
  }
});

test('callLlm の例外はそのまま伝播する（UpstreamError を包まない）', async () => {
  class Boom extends Error {}
  await assert.rejects(
    () =>
      generateSuperset({ drama, season: 0, episode: 0, subtitleText: 'short' }, null, {
        callLlm: async () => {
          throw new Boom('llm down');
        },
        log: silentLog,
      }),
    (err) => err instanceof Boom
  );
});
