// lib/preDomExamples.js（切り替え前の画面字幕の例文の取り直し）の対象判定のテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preDomTargets, PREDOM_CUTOFF } from '../lib/preDomExamples.js';

test('対象は切り替え前に保存・例文あり・手動追加でない・未処理の語だけ', () => {
  const words = [
    { word: 'APOLOGIZE', savedAt: '2026-06-26', sentence: 'LOUIS, I APOLOGIZE.' },
    { word: 'later', savedAt: PREDOM_CUTOFF, sentence: 'After the switch.' },
    { word: 'empty', savedAt: '2026-06-20', sentence: '' },
    { word: 'manual', savedAt: '2026-06-20', sentence: 'x', origin: 'manual' },
    { word: 'iso', savedAt: '2026-06-18T10:00:00.000Z', sentence: 'iso date' },
    { word: 'done', savedAt: '2026-06-18', sentence: 'already' },
    { word: 'slash', savedAt: '2026/6/12', sentence: 'LOUIS, I APOLOGIZE.' },
    { word: 'slashLate', savedAt: '2026/7/20', sentence: 'later' },
  ];
  const out = preDomTargets(words, new Set(['done'])).map((w) => w.word);
  assert.deepEqual(out, ['APOLOGIZE', 'iso', 'slash']);
});
