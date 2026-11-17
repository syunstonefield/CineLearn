// カードの大の名前から開く一覧のシート（lib/relatedView.js catSheetData・2026-11-17）
import test from 'node:test';
import assert from 'node:assert/strict';
import { catSheetData } from '../lib/relatedView.js';

const W = (word, sub, extra = {}) => ({ word, definition: 'いみ', // 意味の重なりを同じに（表なし＝最近の順だけを見る）
  cat: 'action', sub, catv: 1, ...extra });
const hist = [
  { drama: { title: 'Loki' }, words: [W('renovate', 'breakfix'), W('prune', 'breakfix'), W('delete', 'breakfix'), W('obliterate', 'breakfix'), W('rebuild', 'breakfix'), W('run', 'move'), W('quit', 'startstop'), W('happy', 'joy', { cat: 'emotion' })] },
  { drama: { title: 'Suits' }, words: [W('dash', 'move')] },
];
const srs = Object.fromEntries(['renovate', 'prune', 'delete', 'obliterate', 'rebuild', 'run', 'quit', 'happy', 'dash'].map((k, i) => [k, { lastReview: `2026-11-${String(10 + i).padStart(2, '0')}` }]));

test('近い意味＝小が同じ語を全部（札の3つより多くても）・いまの語がいちばん上で印つき', () => {
  const d = catSheetData(W('renovate', 'breakfix'), hist, srs);
  assert.equal(d.label, '動き・行動');
  assert.equal(d.count, 8);
  assert.deepEqual(d.near.map((r) => r.word), ['renovate', 'rebuild', 'obliterate', 'delete', 'prune']);
  assert.equal(d.near[0].self, true);
  assert.equal(d.near[1].self, false);
});

test('ほかの語は小ごと（大の表の順）・ほかの大の語は入らない・1行は語・意味・作品名だけ', () => {
  const d = catSheetData(W('renovate', 'breakfix'), hist, srs);
  assert.deepEqual(d.subs.map((g) => g.sub), ['move', 'startstop']);
  assert.deepEqual(d.subs[0].words.map((r) => r.word), ['dash', 'run']);
  assert.deepEqual(Object.keys(d.subs[0].words[0]).sort(), ['definition', 'self', 'word', 'work']);
  assert.equal(d.subs[0].words[0].work, 'Suits');
});

test('学んでいない語・other・値なしは null か入らない', () => {
  assert.equal(catSheetData({ word: 'x', cat: 'other', sub: '', catv: 1 }, hist, srs), null);
  assert.equal(catSheetData({ word: 'x' }, hist, srs), null);
  const noSrs = { ...srs }; delete noSrs.dash;
  assert.ok(!catSheetData(W('renovate', 'breakfix'), hist, noSrs).subs[0].words.some((r) => r.word === 'dash'));
});

test('近い意味は⑦の表の番号の順・拡張で保存した語（値なし）も表で入る（2026-11-18）', async () => {
  const { setCatTable } = await import('../lib/catTable.js');
  setCatTable({ catv: 1, words: { renovate: 'action.breakfix.5', rebuild: 'action.breakfix.0', prune: 'action.breakfix.4', delete: 'action.breakfix.9', obliterate: 'action.breakfix.8', mend: 'action.breakfix.6' } });
  try {
    const mine = [{ word: 'mend', ja: '直す', dramaTitle: 'Friends' }];
    const d = catSheetData(W('renovate', 'breakfix'), hist, { ...srs, mend: { lastReview: '2026-11-01' } }, null, mine);
    assert.deepEqual(d.near.map((r) => r.word), ['renovate', 'prune', 'mend', 'obliterate', 'delete', 'rebuild']);
    assert.equal(d.near.find((r) => r.word === 'mend').work, 'Friends');
  } finally {
    setCatTable(null);
  }
});
