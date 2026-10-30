// lib/wordbookCefr.js（単語帳の CEFR 目安＝予習の記録から level / levelShown を借りる）の単体テスト。
//   node --import ../seed/register-hooks.mjs --test 'scripts/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cefrIndexFromHistory, withWordbookCefr } from '../lib/wordbookCefr.js';
import { cefrHintOf } from '../lib/cefrHint.js';

const history = [
  { drama: { title: 'Suits' }, words: [
    { word: 'Settle', pos: '動詞', level: 'B1' },                       // 公開前に作ったリスト＝AI の段階だけ
    { word: 'freak out', pos: '句動詞', level: 'B2' },                  // 複数語＝出さない
  ] },
  { drama: { title: 'Friends' }, words: [
    { word: 'settle', pos: '動詞', level: 'B1', levelShown: 'B2' },     // 公開後に開いたリスト＝表の段階あり
    { word: 'bail', pos: '名詞', level: 'C1', levelShown: 'C1' },
  ] },
];

test('表の段階 levelShown を持つ記録を優先して索引する', () => {
  const idx = cefrIndexFromHistory(history);
  assert.equal(idx.get('settle').levelShown, 'B2');
  assert.equal(idx.get('bail').levelShown, 'C1');
  assert.equal(idx.has('freak out'), false);
});

test('保存レコードに level が無くても履歴から借りて目安が出る（表の段階は濃く・AI は淡く）', () => {
  const idx = cefrIndexFromHistory(history);
  const saved = { word: 'settle', pos: '動詞', definition: '落ち着く', source: 'star' };
  assert.deepEqual(cefrHintOf(withWordbookCefr(saved, idx)), { level: 'B2', ai: false });
  const aiOnly = cefrIndexFromHistory([history[0]]);
  assert.deepEqual(cefrHintOf(withWordbookCefr(saved, aiOnly)), { level: 'B1', ai: true });
});

test('履歴に無い語・品詞が食い違う語には借りない', () => {
  const idx = cefrIndexFromHistory(history);
  assert.equal(cefrHintOf(withWordbookCefr({ word: 'hustle', pos: '動詞' }, idx)), null);
  assert.equal(cefrHintOf(withWordbookCefr({ word: 'bail', pos: '動詞' }, idx)), null); // 履歴は名詞
  assert.deepEqual(cefrHintOf(withWordbookCefr({ word: 'bail', pos: '' }, idx)), { level: 'C1', ai: false }); // 品詞なしは借りる
});

test('レコード自身の値があればそれを優先し、元のレコードは変えない', () => {
  const idx = cefrIndexFromHistory(history);
  const saved = { word: 'settle', levelShown: 'A2' };
  const out = withWordbookCefr(saved, idx);
  assert.equal(out.levelShown, 'A2');
  assert.equal(saved.level, undefined);
});
