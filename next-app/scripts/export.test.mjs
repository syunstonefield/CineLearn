// lib/export.js（単語・意味・SRS 履歴の書き出し）の単体テスト。
//   node --import ../seed/register-hooks.mjs --test 'scripts/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectExportRows, toCsv, toAnkiTsv, EXPORT_EXAMPLES_PER_EPISODE } from '../lib/export.js';

const ep = (title, season, episode, n, date = '2026-08-01') => ({
  date,
  drama: { title },
  season,
  episode,
  words: Array.from({ length: n }, (_, i) => ({ word: `w${title}${i}`, definition: `意味${i}`, pos: 'noun', example: `Line ${i} with w${title}${i}.` })),
});

test('1話あたりの例文は上限まで・超えた語も単語とSRSは出る・出典は例文と同じ欄', () => {
  const rows = collectExportRows({ history: [ep('Suits', 1, 2, 25)] });
  assert.equal(rows.length, 25);
  const withEx = rows.filter((r) => r.example);
  assert.equal(withEx.length, EXPORT_EXAMPLES_PER_EPISODE);
  withEx.forEach((r) => assert.match(r.example, /出典: Suits S1E2（字幕：OpenSubtitles）$/));
});

test('例文なしの指定では例文欄が空', () => {
  const rows = collectExportRows({ history: [ep('Suits', 1, 2, 3)], includeExamples: false });
  assert.ok(rows.every((r) => r.example === ''));
});

test('SRS 履歴・状態・SRS だけの語（origin）・映画は話数を書かない', () => {
  const srs = {
    wsuits0: { easeFactor: 2.6, interval: 25, repetitions: 3, lastReview: '2026-09-01', dueDate: '2026-09-26' },
    orphan: { easeFactor: 2.5, interval: 6, repetitions: 2, lastReview: '2026-09-01', dueDate: '2026-09-07', origin: { title: 'Gone', season: 2, episode: 3 } },
  };
  const rows = collectExportRows({
    history: [ep('Suits', 1, 2, 1), ep('Heat', null, null, 1)],
    srs,
    movieTitles: new Set(['Heat']),
  });
  const s = rows.find((r) => r.key === 'wsuits0');
  assert.equal(s.status, 'マスター');
  assert.equal(s.interval, 25);
  const o = rows.find((r) => r.key === 'orphan');
  assert.equal(o.title, 'Gone');
  assert.equal(o.status, '覚えた');
  const h = rows.find((r) => r.key === 'wheat0');
  assert.equal(h.season, null);
  assert.match(h.example, /出典: Heat（字幕：OpenSubtitles）$/);
});

test('単語帳の語（拡張保存）は sentence/ja を使い、重複は予習側を優先', () => {
  const rows = collectExportRows({
    history: [ep('Suits', 1, 2, 1)],
    myWords: [
      { word: 'wSuits0', ja: '別', sentence: 'dup' },
      { word: 'bargain', ja: '取引', sentence: 'It is a bargain.', dramaTitle: 'Suits', season: 1, episode: 5 },
    ],
  });
  assert.equal(rows.length, 2);
  const b = rows.find((r) => r.key === 'bargain');
  assert.equal(b.meaning, '取引');
  assert.equal(b.via, '単語帳');
  assert.match(b.example, /^It is a bargain\. — 出典: Suits S1E5/);
});

test('plus 語（作例）は出典なし・上限に数えない', () => {
  const h = ep('Suits', 1, 2, EXPORT_EXAMPLES_PER_EPISODE);
  h.words.push({ word: 'extra', definition: 'x', example: 'Made up.', source: 'plus' });
  const rows = collectExportRows({ history: [h] });
  assert.equal(rows.find((r) => r.key === 'extra').example, 'Made up.');
  assert.equal(rows.filter((r) => /出典/.test(r.example)).length, EXPORT_EXAMPLES_PER_EPISODE);
});

test('CSV: BOM・CRLF・引用符と数式インジェクション対策', () => {
  const csv = toCsv([{ word: '=cmd', meaning: 'a,"b"', pos: '', title: 'T', season: 1, episode: 1, via: '予習', status: '未学習', easeFactor: '', interval: '', repetitions: '', lastReview: '', dueDate: '', reviewCount: '', example: '', exampleJa: '' }]);
  assert.ok(csv.startsWith('﻿単語,意味'));
  assert.ok(csv.includes('\r\n'));
  assert.ok(csv.includes(`'=cmd,"a,""b"""`));
});

test('Anki: ヘッダ・タブ区切り・HTML エスケープ・欄内のタブ/改行なし', () => {
  const rows = collectExportRows({ history: [ep('My Show', 1, 1, 1)] });
  rows[0].meaning = 'a\tb\n<c>';
  const txt = toAnkiTsv(rows);
  assert.ok(txt.startsWith('#separator:tab\n#html:true\n#tags column:3\n'));
  const line = txt.replace(/\n$/, '').split('\n').pop().split('\t');
  assert.equal(line.length, 10);
  assert.match(line[1], /a b &lt;c&gt;/);
  assert.match(line[2], /CineLearn::My_Show_S1E1/);
});
