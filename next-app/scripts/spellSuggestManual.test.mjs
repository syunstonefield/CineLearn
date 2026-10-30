// 2026-10-30 手動追加の綴りミス候補（サーバ側・法務の条件1/4）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualSpellSuggestions } from '../lib/server/spellSuggestManual.js';

const SRT = `1
00:00:10,000 --> 00:00:12,000
If the trade was ever under suspicion, even the trader couldn't point to Burt.

2
00:00:20,000 --> 00:00:22,000
So when Miss Stone made the trade, you weren't suspicious?

3
00:00:50,000 --> 00:00:52,000
Put the handcuffs on him. This is a coincidence.
`;
const cap = (s) => s;
const cached = [
  { word: 'coincidence', source: 'drama', example: 'This is either a hell of a coincidence, or these traders were lucky.', tsSec: 1791, tsLabel: '29:51' },
  { word: 'suspicion', source: 'plus', example: 'AI made this sentence about suspicion.' },
];

test('層1（vocab_cache の drama 語）にあれば、その例文を最も近い候補に付ける（条件1）', async () => {
  let charged = 0;
  const out = await manualSpellSuggestions('coincidance', { cached, raw: SRT, charge: async () => (charged++, { ok: true }), cap });
  assert.equal(out[0].word, 'coincidence');
  assert.match(out[0].sentence, /coincidence/);
  assert.equal(out[0].tsLabel, '29:51');
  assert.equal(out[0].source, 'opensubtitles');
  assert.equal(charged, 1, '候補一覧で上限を1回数える（条件4）');
});

test('plus（AI のおすすめ語）は候補にしない。無ければ raw の語から（条件1）', async () => {
  const out = await manualSpellSuggestions('suspiciun', { cached, raw: SRT, charge: async () => ({ ok: true }), cap });
  assert.equal(out[0].word, 'suspicion');
  assert.match(out[0].sentence, /under suspicion/, 'raw から取った1文');
  assert.equal(out[0].tsLabel, '0:10');
});

test('例文が付くのは最も近い1候補だけ。ほかは語だけ（条件4）', async () => {
  const out = await manualSpellSuggestions('suspiciun', { cached, raw: SRT, charge: async () => ({ ok: true }), cap });
  assert.ok(out.length >= 2);
  for (const c of out.slice(1)) assert.deepEqual(Object.keys(c), ['word']);
});

test('上限を超えたら候補を付けない（条件4）', async () => {
  const out = await manualSpellSuggestions('suspiciun', { cached, raw: SRT, charge: async () => ({ ok: false }), cap });
  assert.deepEqual(out, []);
});

test('候補が無い時は上限を数えない', async () => {
  let charged = 0;
  const out = await manualSpellSuggestions('zxqwerty', { cached, raw: SRT, charge: async () => (charged++, { ok: true }), cap });
  assert.deepEqual(out, []);
  assert.equal(charged, 0);
});

test('raw も cached も無ければ空', async () => {
  const out = await manualSpellSuggestions('suspiciun', { cached: null, raw: null, charge: async () => ({ ok: true }), cap });
  assert.deepEqual(out, []);
});
