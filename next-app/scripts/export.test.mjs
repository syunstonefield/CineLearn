// lib/export.js（単語・意味・SRS 履歴の書き出し）の単体テスト。
//   node --import ../seed/register-hooks.mjs --test 'scripts/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectExportRows, toCsv, toAnkiTsv, ankiRows } from '../lib/export.js';
import { isMovieWork, subtitleCredit } from '../lib/storage.js';

const ep = (title, season, episode, n, date = '2026-08-01') => ({
  date,
  drama: { title },
  season,
  episode,
  words: Array.from({ length: n }, (_, i) => ({ word: `w${title}${i}`, definition: `意味${i}`, pos: 'noun', example: `Line ${i} with w${title}${i}.` })),
});

test('例文は書き出さない（CSV の列にも Anki の裏にも出ない）・裏に出会った場面', () => {
  const rows = collectExportRows({ history: [ep('Suits', 1, 2, 3)], movies: new Set() });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => !('example' in r)));
  const csv = toCsv(rows);
  assert.ok(!csv.includes('例文'));
  assert.ok(!csv.includes('Line 0'));
  const anki = toAnkiTsv(rows);
  assert.ok(!anki.includes('Line 0'));
  assert.match(anki, /出会った場面: Suits S1E2/);
});

test('SRS 履歴・状態・SRS だけの語（origin）・映画は話数を書かない', () => {
  const srs = {
    wsuits0: { easeFactor: 2.6, interval: 25, repetitions: 3, lastReview: '2026-09-01', dueDate: '2026-09-26' },
    orphan: { easeFactor: 2.5, interval: 6, repetitions: 2, lastReview: '2026-09-01', dueDate: '2026-09-07', origin: { title: 'Gone', season: 2, episode: 3 } },
  };
  const rows = collectExportRows({
    history: [ep('Suits', 1, 2, 1), ep('Heat', 1, 1, 1)],
    srs,
    movies: new Set(['heat']),
  });
  const s = rows.find((r) => r.key === 'wsuits0');
  assert.equal(s.status, 'マスター');
  assert.equal(s.interval, 25);
  const o = rows.find((r) => r.key === 'orphan');
  assert.equal(o.title, 'Gone');
  assert.equal(o.status, '覚えた');
  const h = rows.find((r) => r.key === 'wheat0');
  assert.equal(h.season, null); // 予習の記録に S1E1 が入っていても映画なら話数を書かない
  assert.match(toAnkiTsv(rows), /出会った場面: Heat</);
});

test('単語帳の語（拡張保存）は ja を使い、重複は予習側を優先', () => {
  const rows = collectExportRows({
    history: [ep('Suits', 1, 2, 1)],
    myWords: [
      { word: 'wSuits0', ja: '別', sentence: 'dup' },
      { word: 'bargain', ja: '取引', sentence: 'It is a bargain.', dramaTitle: 'Suits', season: 1, episode: 5 },
    ],
    movies: new Set(),
  });
  assert.equal(rows.length, 2);
  const b = rows.find((r) => r.key === 'bargain');
  assert.equal(b.meaning, '取引');
  assert.equal(b.via, '単語帳');
  assert.equal(b.episode, 5);
  assert.ok(!toCsv(rows).includes('It is a bargain'));
});

test('映画判定: 記録の type が最優先・作品一覧で映画なら映画・出典に偽の S1E1 や Snull を付けない', () => {
  const set = new Set(['harrypotterandthephilosophersstone']);
  assert.equal(isMovieWork("Harry Potter and the Philosopher's Stone", undefined, set), true);
  assert.equal(isMovieWork('Loki', undefined, set), false);
  assert.equal(isMovieWork('Loki', 'movie', set), true);
  assert.equal(subtitleCredit({ _src: { title: 'Endgame', season: 1, episode: 1, type: 'movie' } }), '📺 Endgame（字幕：OpenSubtitles）');
  assert.equal(subtitleCredit({ _src: { title: 'Suits', season: null, episode: null } }), '📺 Suits（字幕：OpenSubtitles）');
  assert.equal(subtitleCredit({ _src: { title: 'Suits', season: 1, episode: 3, type: 'tv' } }), '📺 Suits S1E3（字幕：OpenSubtitles）');
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

test('Anki: 意味が空の語は外す（CSV には残す）', () => {
  const base = { pos: '', title: 'T', season: 1, episode: 1, via: '予習', status: '未学習', easeFactor: '', interval: '', repetitions: '', lastReview: '', dueDate: '', reviewCount: '', example: '', exampleJa: '' };
  const rows = [{ ...base, word: 'kept', meaning: '残る' }, { ...base, word: 'blank', meaning: '  ' }];
  assert.equal(ankiRows(rows).length, 1);
  const txt = toAnkiTsv(rows);
  assert.ok(txt.includes('kept'));
  assert.ok(!txt.includes('blank'));
  assert.ok(toCsv(rows).includes('blank'));
});
