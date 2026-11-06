// 作品の「最近触った」時刻（lib/workRecency.js・2026-11-07）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workRecency, byRecency } from '../lib/workRecency.js';

const row = (title, date, words) => ({ id: title + date, drama: { title }, season: 1, episode: 1, date, words: words.map((w) => ({ word: w })) });
const order = (rec, titles) => [...titles].sort(byRecency(rec, (t) => t));

test('作った日だけなら従来どおり新しい順', () => {
  const rec = workRecency({ history: [row('Suits', '2026-11-05', ['a']), row('Iron Man', '2026-11-01', ['b'])], srs: {} });
  assert.deepEqual(order(rec, ['Iron Man', 'Suits']), ['Suits', 'Iron Man']);
});

test('復習すると上がる（SRS の updatedAt・無ければ lastReview の日付）', () => {
  const history = [row('Suits', '2026-11-05', ['a']), row('Iron Man', '2026-11-01', ['genius'])];
  const rec = workRecency({ history, srs: { genius: { lastReview: '2026-11-07', updatedAt: '2026-11-07T03:00:00Z' } } });
  assert.deepEqual(order(rec, ['Suits', 'Iron Man']), ['Iron Man', 'Suits']);
  const rec2 = workRecency({ history, srs: { genius: { lastReview: '2026-11-06' } } });
  assert.deepEqual(order(rec2, ['Suits', 'Iron Man']), ['Iron Man', 'Suits']);
  // 「知ってる」で飛ばしただけの語は数えない
  const rec3 = workRecency({ history, srs: { genius: { skipped: true, updatedAt: '2026-11-07T03:00:00Z' } } });
  assert.deepEqual(order(rec3, ['Suits', 'Iron Man']), ['Suits', 'Iron Man']);
});

test('拡張で保存・開いた/戻した時刻でも上がる（作品名の揺れは履歴の作品名へ寄せる）', () => {
  const history = [row('Suits', '2026-11-05', ['a']), row('Iron Man', '2026-11-01', ['b'])];
  const same = (a, b) => (a === 'Iron Man' && b === 'アイアンマン') || (a === 'アイアンマン' && b === 'Iron Man');
  const saved = workRecency({ history, srs: {}, myWords: [{ word: 'x', dramaTitle: 'アイアンマン', createdAt: '2026-11-07T01:00:00Z' }], sameTitle: same });
  assert.deepEqual(order(saved, ['Suits', 'Iron Man']), ['Iron Man', 'Suits']);
  const opened = workRecency({ history, srs: {}, myDramas: [{ title: 'Iron Man', touchedAt: Date.parse('2026-11-06T00:00:00Z') }] });
  assert.deepEqual(order(opened, ['Suits', 'Iron Man']), ['Iron Man', 'Suits']);
});

test('同じ時刻は今までの並び（安定）', () => {
  const rec = workRecency({ history: [row('A', '2026-11-05', []), row('B', '2026-11-05', [])], srs: {} });
  assert.deepEqual(order(rec, ['A', 'B']), ['A', 'B']);
});
