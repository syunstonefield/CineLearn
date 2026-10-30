// lib/wordbookCefr.js（単語帳の CEFR 目安＝予習の記録から写す埋め戻し）の単体テスト。
//   node --import ../seed/register-hooks.mjs --test 'scripts/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cefrPatchesFromHistory, backfillCefrFromHistory } from '../lib/wordbookCefr.js';
import { cefrHintOf } from '../lib/cefrHint.js';

const history = [
  { drama: { title: 'Suits' }, season: 1, episode: 1, words: [
    { word: 'settle', pos: '動詞', level: 'B1', levelShown: 'B2', source: 'drama' }, // 公開後のリスト＝表の段階あり
    { word: 'hustle', pos: '動詞', level: 'B2', source: 'drama' },                   // 公開前のリスト＝AI だけ
    { word: 'freak out', pos: '句動詞', level: 'B2', source: 'drama' },              // 複数語＝出さない
    { word: 'bail', pos: '名詞', level: 'C1', levelShown: 'C1', source: 'drama' },
    { word: 'litigate', pos: '動詞', level: 'C1', source: 'plus' },                  // おすすめ語＝表の段階なし
  ] },
  { drama: { title: 'Suits' }, season: 1, episode: 2, words: [
    { word: 'subpoena', pos: '名詞', level: 'C1', levelShown: 'C1', source: 'drama' },
  ] },
];

test('同じ作品・同じ話のリストにある語だけ写す（表の段階は濃く・AI は淡く）', () => {
  const words = [
    { word: 'settle', pos: '動詞', dramaTitle: 'Suits', season: 1, episode: 1, source: 'star' },
    { word: 'hustle', pos: '動詞', dramaTitle: 'Suits', season: 1, episode: 1, source: 'ext' },
    { word: 'subpoena', pos: '名詞', dramaTitle: 'Suits', season: 1, episode: 1, source: 'ext' }, // 別の話＝写さない
    { word: 'freak out', pos: '句動詞', dramaTitle: 'Suits', season: 1, episode: 1 },
    { word: 'litigate', pos: '動詞', dramaTitle: 'Suits', season: 1, episode: 1, source: 'star' },
  ];
  const p = Object.fromEntries(cefrPatchesFromHistory(words, history).map((x) => [x.word, x.patch]));
  assert.deepEqual(p.settle, { levelShown: 'B2', level: 'B1', listSource: 'drama' });
  assert.deepEqual(p.hustle, { level: 'B2', listSource: 'drama' });
  assert.equal(p.subpoena, undefined);
  assert.equal(p['freak out'], undefined);
  assert.deepEqual(p.litigate, { level: 'C1', listSource: 'plus' }); // おすすめ語は AI だけ（条件2）
  assert.deepEqual(cefrHintOf({ ...words[0], ...p.settle }), { level: 'B2', ai: false });
  assert.deepEqual(cefrHintOf({ ...words[1], ...p.hustle }), { level: 'B2', ai: true });
});

test('品詞が食い違う語・作品が分からない語・既に写した語には触らない', () => {
  const words = [
    { word: 'bail', pos: '動詞', dramaTitle: 'Suits', season: 1, episode: 1 }, // 履歴は名詞
    { word: 'settle', pos: '動詞' },                                           // 作品なし
    { word: 'subpoena', pos: '名詞', dramaTitle: 'Suits', season: 1, episode: 2, levelShown: 'A2' },
  ];
  assert.deepEqual(cefrPatchesFromHistory(words, history), []);
});

test('S/E の無い保存語（映画・話数不明）は作品一致だけで写す・作品名の同一判定は差し替えられる', () => {
  const words = [{ word: 'bail', pos: '', dramaTitle: 'スーツ', season: null, episode: null }];
  const sameTitle = (a, b) => (a === 'Suits' && b === 'スーツ') || a === b;
  const p = cefrPatchesFromHistory(words, history, { sameTitle });
  assert.deepEqual(p, [{ word: 'bail', patch: { levelShown: 'C1', level: 'C1', listSource: 'drama' } }]);
});

test('backfill は save を語ごとに呼び、写した後の配列を返す（何も無ければ null・元の配列は変えない）', async () => {
  const words = [{ word: 'settle', pos: '動詞', dramaTitle: 'Suits', season: 1, episode: 1 }];
  const calls = [];
  const out = await backfillCefrFromHistory(words, history, 'p1', { save: async (pid, w, patch) => calls.push([pid, w, patch]) });
  assert.deepEqual(calls, [['p1', 'settle', { levelShown: 'B2', level: 'B1', listSource: 'drama' }]]);
  assert.equal(out[0].levelShown, 'B2');
  assert.equal(words[0].levelShown, undefined);
  assert.equal(await backfillCefrFromHistory([{ word: 'nope', dramaTitle: 'Suits', season: 1, episode: 1 }], history, 'p1', {}), null);
});
