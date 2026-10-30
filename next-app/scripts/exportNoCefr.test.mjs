// 書き出し（CSV / Anki）に CEFR の段階（表の値 levelShown・AI の level）が混ざらないことの単体テスト（2026-10-30）。
//   法務 条件1: 表の段階の一覧の書き出しは作らない。lib/export.js は列を白リスト（COLUMNS）で組むので、
//   語オブジェクトが levelShown を持っていても列には出ない＝それが崩れたら落ちる番兵。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectExportRows, toCsv, toAnkiTsv } from '../lib/export.js';

const history = [
  { date: '2026-10-29', drama: { title: 'Suits', type: 'tv' }, season: 1, episode: 1, words: [
    { word: 'settle', pos: '動詞', definition: '解決する', level: 'B1', levelShown: 'B2', tier: 'core' },
  ] },
];
const myWords = [
  { word: 'leverage', pos: '名詞', ja: '切り札', dramaTitle: 'Suits', season: 1, episode: 1, level: 'C1', levelShown: 'C1' },
];

test('書き出しの行には level / levelShown が無い', () => {
  const rows = collectExportRows({ history, srs: {}, myWords, movies: new Set() });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal('level' in r, false);
    assert.equal('levelShown' in r, false);
  }
});

test('CSV の見出しと Anki の列に CEFR の段階が出ない', () => {
  const rows = collectExportRows({ history, srs: {}, myWords, movies: new Set() });
  const csv = toCsv(rows);
  const head = csv.split('\r\n')[0];
  assert.doesNotMatch(head, /CEFR|level/i);
  assert.doesNotMatch(csv, /\b(B1|B2|C1)\b/);
  const anki = toAnkiTsv(rows);
  assert.doesNotMatch(anki, /\b(B1|B2|C1)\b/);
  assert.doesNotMatch(anki, /CEFR::|level/i);
});
