// 2026-10-30 綴りミスの候補（案B・法務「条件付きOK」）の単体テスト。
//   法務の条件: 入力4字以上／距離 5字以下=1・6字以上=2／3字以下と COMMON_WORDS は候補にしない／最大3語。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { osaDistance, spellAllowance, suggestSpellings, wordsFromSubtitle, SPELL_MAX_CANDIDATES } from '../lib/spellSuggest.js';
import { COMMON_WORDS } from '../lib/server/commonWords.js';

const SRT = `1
00:00:10,000 --> 00:00:12,000
If the trade was ever under suspicion, even the trader couldn't point to Burt.

2
00:00:20,000 --> 00:00:22,000
So when Miss Stone made the trade, you weren't suspicious?

3
00:00:30,000 --> 00:00:32,000
Burt and the traders. Burt was there. Burt!

4
00:00:40,000 --> 00:00:42,000
♪ Hallelujah, the dazzling chorus ♪

5
00:00:50,000 --> 00:00:52,000
Put the handcuffs on him. This is a coincidence.
`;

const words = wordsFromSubtitle(SRT);
const exclude = (w) => COMMON_WORDS.has(w);

test('osaDistance: 入れ替えは1・上限を超えたら max+1', () => {
  assert.equal(osaDistance('reileved', 'relieved', 2), 1);
  assert.equal(osaDistance('gntlemen', 'gentlemen', 2), 1);
  assert.equal(osaDistance('suspiciun', 'suspicion', 2), 1);
  assert.equal(osaDistance('abcdef', 'uvwxyz', 2), 3);
});

test('距離の許容: 5字以下=1・6字以上=2（法務 条件3）', () => {
  assert.equal(spellAllowance(4), 1);
  assert.equal(spellAllowance(5), 1);
  assert.equal(spellAllowance(6), 2);
  assert.equal(spellAllowance(12), 2);
});

test('字幕の語: 固有名詞（8割以上が大文字始まり）と ♪ の歌詞は語にしない', () => {
  const set = new Set(words.map((w) => w.word));
  assert.ok(set.has('suspicion') && set.has('handcuffs'));
  assert.ok(!set.has('burt'), '人名は除く');
  assert.ok(!set.has('dazzling'), '♪ の行は除く');
});

test('1か所の綴りミスから正しい語を出す', () => {
  assert.equal(suggestSpellings('suspiciun', words, { exclude })[0], 'suspicion');
  assert.equal(suggestSpellings('handkufs', words, { exclude })[0], 'handcuffs'); // 2か所ミス（k→c・f 抜け）・8字は距離2まで
  assert.deepEqual(suggestSpellings('hndkufs', words, { exclude }), []); // 3か所ミスは出さない
  assert.equal(suggestSpellings('handcufs', words, { exclude })[0], 'handcuffs');
  assert.equal(suggestSpellings('coincidance', words, { exclude })[0], 'coincidence');
});

test('入力4字未満・複数語・記号入りは候補を出さない（法務 条件2）', () => {
  assert.deepEqual(suggestSpellings('trd', words, { exclude }), []);
  assert.deepEqual(suggestSpellings('trade deal', words, { exclude }), []);
  assert.deepEqual(suggestSpellings('trad3r', words, { exclude }), []);
});

test('COMMON_WORDS と3字以下の語は候補にしない（法務 条件3）', () => {
  // "tradr" に近い語: trader（候補）・trade（頻出語なら除外）
  const out = suggestSpellings('tradr', words, { exclude });
  for (const w of out) {
    assert.ok(!COMMON_WORDS.has(w), `${w} は頻出語`);
    assert.ok(w.length > 3);
  }
  assert.deepEqual(suggestSpellings('evenn', [{ word: 'even' }, { word: 'eve' }], { exclude }), []);
});

test('同じ語の活用形は1つにまとめ、最大3語まで', () => {
  const many = ['trader', 'traders', 'trades', 'grader', 'tracer', 'trailer', 'tradesman'].map((word) => ({ word }));
  const out = suggestSpellings('tradrr', many);
  assert.ok(out.length <= SPELL_MAX_CANDIDATES);
  assert.equal(out[0], 'trader');
  assert.ok(!(out.includes('trader') && out.includes('traders')), '活用形はまとめる');
});

test('入力そのものと同じ語は候補にしない（完全一致は呼び出し側で先に当たる）', () => {
  assert.deepEqual(suggestSpellings('trader', [{ word: 'trader' }]), []);
});

test('並べ順: 距離 → 頭文字が同じ → 出現回数', () => {
  const out = suggestSpellings('bilang', [
    { word: 'begging', n: 9 },
    { word: 'billing', n: 1 },
  ]);
  assert.equal(out[0], 'billing');
});
