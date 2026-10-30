// 2026-10-30 例文の補完（backfillMissingExamples）が、例文の無い手動追加の語に問い合わせない。
//   以前は「例文あり・📍なし」の判定が例文の有無を見ておらず、空のアンカーで1回問い合わせていた。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillMissingExamples } from '../lib/exampleBackfill.js';

const drama = { title: 'Suits', englishTitle: 'Suits', tmdbId: 37680, type: 'tv' };

function captureFetch() {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ found: false, reason: 'no_match' }), { status: 200 });
  };
  return calls;
}

test('例文の無い手動追加の語には問い合わせない', async () => {
  const calls = captureFetch();
  await backfillMissingExamples([{ word: 'spi', example: '', tsSec: null, origin: 'manual', season: 1, episode: 6 }], {
    drama,
    season: 1,
    episode: 6,
    isMovie: false,
  });
  assert.equal(calls.length, 0);
});

test('例文あり・📍なしの語は、例文をアンカーにして時刻を聞く（今まで通り）', async () => {
  const calls = captureFetch();
  await backfillMissingExamples(
    [{ word: 'trader', example: "She wasn't just a trader.", tsSec: null, origin: 'manual', season: 1, episode: 6 }],
    { drama, season: 1, episode: 6, isMovie: false }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lineText, "She wasn't just a trader.");
});

test('拡張で保存した例文の無い語は、例文の補完を聞く（今まで通り）', async () => {
  const calls = captureFetch();
  await backfillMissingExamples([{ word: 'grader', example: '', tsSec: null, origin: 'extension', season: 1, episode: 6 }], {
    drama,
    season: 1,
    episode: 6,
    isMovie: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lineText, undefined);
});
