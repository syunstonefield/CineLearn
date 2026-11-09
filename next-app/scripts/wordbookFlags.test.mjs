// lib/wordbookFlags.js（「★の語だけにする」でクラウドへ送る語と in フィルタ）の単体テスト。
// 2026-11-10 ⑤の連絡: 語を小文字にして upsert していたため、大文字を含む語で小文字の空の行ができていた。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactWordsToFlag, pgrstInFilter } from '../lib/wordbookFlags.js';

test('送る語は端末の綴りそのまま（小文字にしない）・重複なし', () => {
  const global = [{ word: 'Harvey' }, { word: 'objection' }, { word: 'Pearson Hardman' }, { word: 'other' }];
  const profile = [{ word: 'Harvey' }, { word: 'Objection' }];
  const got = exactWordsToFlag([global, profile], ['Harvey', 'objection', 'Pearson Hardman']);
  assert.deepEqual(got.sort(), ['Harvey', 'Objection', 'Pearson Hardman', 'objection'].sort());
  assert.ok(!got.includes('harvey'), '小文字版を作らない');
  assert.ok(!got.includes('pearson hardman'));
  assert.ok(!got.includes('other'), '指定していない語は送らない');
});

test('空・null は送らない', () => {
  assert.deepEqual(exactWordsToFlag([[{ word: '' }, null]], ['', null, undefined]), []);
  assert.deepEqual(exactWordsToFlag(null, null), []);
});

test('in フィルタは値を二重引用符で囲み、\\ と " をエスケープ', () => {
  assert.equal(pgrstInFilter(['Harvey', 'a,b', 'Mr. (x)']), 'in.("Harvey","a,b","Mr. (x)")');
  assert.equal(pgrstInFilter(['say "hi"', 'back\\slash']), 'in.("say \\"hi\\"","back\\\\slash")');
});

test('supabase.js の旗の一括送信は PATCH（行を作らない）で、upsert に戻っていない', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../lib/supabase.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function pushWordbookFlags'), src.indexOf('export async function deleteMyWordCloud'));
  assert.match(body, /method: 'PATCH'/);
  assert.doesNotMatch(body, /merge-duplicates/);
  const words = readFileSync(new URL('../lib/words.js', import.meta.url), 'utf8');
  const hide = words.slice(words.indexOf('export function hideFromWordbook'), words.indexOf('async function setWordbookFlag'));
  assert.doesNotMatch(hide, /pushWordbookFlags\(\[\.\.\.set\]/, '小文字の Set をそのまま送らない');
});
