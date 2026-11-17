// 関連語を「意味が近い順」に（2026-11-18）: 表の並びの番号 → 意味の重なり → 最近の順。拡張で保存した語も表で引く。
import test from 'node:test';
import assert from 'node:assert/strict';
import { relatedWords, nearSort, catOfAny, withMyWords, groupByCat, defScore } from '../lib/related.js';
import { tableEntry, setCatTable, loadCatTable, catTableNow } from '../lib/catTable.js';
import { catFields } from '../lib/relCategories.js';
import { buildOrderPrompt, parseOrderReply } from '../lib/server/catOrder.js';

const TABLE = {
  catv: 1,
  words: {
    outrage: 'emotion.anger.0',
    mad: 'emotion.anger.1',
    furious: 'emotion.anger.2',
    grudge: 'emotion.anger.9',
    vengeful: 'emotion.anger.10',
    sore: 'emotion.anger',
    glad: 'emotion.joy.0',
    odd: 'other',
  },
};
const H = (word, k, definition, extra = {}) => ({ word, definition, ...catFields(k), _src: { title: '作品', season: 1, episode: 1 }, ...extra });

test('表を引く: 番号つき・番号なし・other・無い語', () => {
  assert.deepEqual(tableEntry('Mad', TABLE), { cat: 'emotion', sub: 'anger', pos: 1 });
  assert.deepEqual(tableEntry('sore', TABLE), { cat: 'emotion', sub: 'anger', pos: null });
  assert.deepEqual(tableEntry('odd', TABLE), { cat: 'other', sub: '', pos: null });
  assert.equal(tableEntry('nope', TABLE), null);
  assert.equal(tableEntry('mad', null), null);
});

test('近い順: 番号の差が小さい順 → 番号なしは意味の重なり → 同点は最近の順', () => {
  const t = H('outrage', 'emotion.anger', '激怒させる');
  const words = [
    H('vengeful', 'emotion.anger', '復讐心に燃えた'),
    H('furious', 'emotion.anger', '激怒した'),
    H('mad', 'emotion.anger', '怒った'),
    H('sore', 'emotion.anger', '怒って・痛くて'),
    H('irate', 'emotion.anger', 'ひどく怒った'), // 表に無い
    H('livid', 'emotion.anger', 'かんかんの'), // 表に無い・重なり0
  ];
  const srs = { livid: { lastReview: '2026-11-17' } };
  assert.deepEqual(nearSort(t, words, { srs, table: TABLE }).map((w) => w.word), ['mad', 'furious', 'vengeful', 'irate', 'sore', 'livid']);
  // 表が無い時は 意味の重なり → 最近の順（今までの並びに近い）
  assert.deepEqual(nearSort(t, words, { srs, table: null }).map((w) => w.word)[0], 'furious');
});

test('意味の重なり: 「する」の重なりは数えない', () => {
  assert.ok(defScore('激怒させる', '激怒した') > 0.5);
  assert.equal(defScore('～するふりをする', 'ほのめかす'), 0);
});

test('関連語の札: 番号の近い学んだ語から・値の無い語（拡張で保存した語）も表で引く', () => {
  const target = H('outrage', 'emotion.anger', '激怒させる');
  const mine = [{ word: 'grudge', ja: '恨み', dramaTitle: '別の作品' }, { word: 'mad', ja: '怒った', dramaTitle: '作品2' }];
  const pool = withMyWords([H('furious', 'emotion.anger', '激怒した'), H('vengeful', 'emotion.anger', '復讐心に燃えた')], mine);
  const srs = { furious: { lastReview: '2026-11-01' }, vengeful: { lastReview: '2026-11-02' }, grudge: { lastReview: '2026-11-03' }, mad: { lastReview: '2026-11-04' } };
  const r = relatedWords(target, pool, { srs, table: TABLE });
  assert.deepEqual(r.map((x) => x.word), ['mad', 'furious', 'grudge']);
  assert.equal(r[2].definition, '恨み');
  assert.equal(r[2].title, '別の作品');
  // 値の無い語（拡張で保存した語）が今のカードでも、表で引いて出す
  const r2 = relatedWords({ word: 'grudge', ja: '恨み' }, pool, { srs, table: TABLE });
  assert.deepEqual(r2.map((x) => x.word), ['vengeful', 'furious', 'mad']);
});

test('拡張で保存した語を足す: history にある語はそのまま・形をそろえる', () => {
  const base = [H('mad', 'emotion.anger', '怒った')];
  const out = withMyWords(base, [{ word: 'Mad', ja: 'x' }, { word: 'sore', ja: '痛い', sentence: 'My leg is sore.', dramaTitle: 'D', season: 2, episode: 3 }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[1]._src, { title: 'D', season: 2, episode: 3 });
  assert.equal(out[1].definition, '痛い');
  assert.equal(out[1].example, 'My leg is sore.');
  assert.equal(withMyWords(base, []), base);
});

test('大ごとのまとまり: 値の無い語も表で入る', () => {
  const g = groupByCat([{ word: 'glad' }, { word: 'odd' }, { word: 'nope' }, H('mad', 'emotion.anger', '')], { table: TABLE });
  assert.deepEqual(g.map((x) => [x.cat, x.count]), [['emotion', 2]]);
  assert.deepEqual(catOfAny({ word: 'glad' }, TABLE), { cat: 'emotion', sub: 'joy' });
});

test('表を取る: 1回だけ・版が違えば使わない・失敗しても投げない', async () => {
  setCatTable(null);
  let n = 0;
  await loadCatTable(async () => (n++, { ok: true, json: async () => ({ catv: 99, words: {} }) }));
  assert.equal(catTableNow(), null);
  await loadCatTable(async () => (n++, { ok: true, json: async () => TABLE }));
  await loadCatTable(async () => (n++, { ok: true, json: async () => TABLE }));
  assert.equal(n, 2);
  assert.equal(catTableNow(), TABLE);
  setCatTable(null);
  assert.equal(await loadCatTable(async () => { throw new Error('offline'); }), null);
});

test('並べる指示と応答: 語と意味だけ・外の名前を出さない・並んだ順の番号', () => {
  const p = buildOrderPrompt('emotion', 'anger', [{ word: 'mad', definition: '怒った' }, { word: 'furious', definition: '激怒した' }]);
  assert.ok(p.includes('0\tmad\t怒った'));
  assert.ok(p.includes('怒り・いらだち'));
  for (const bad of ['WordNet', 'GloVe', 'シソーラス', '類語', '同義語', '辞書']) assert.ok(!p.includes(bad), bad);
  assert.deepEqual(parseOrderReply('2, 0, 1, 0, 9', 3), [1, 2, 0]);
  assert.deepEqual(parseOrderReply('3,1,0,2,4', 5), [2, 1, 3, 0, 4]);
  assert.equal(parseOrderReply('0', 5), null); // 並び損ね
  assert.deepEqual(parseOrderReply('1,0,2,3', 5), [1, 0, 2, 3, null]); // 4/5 は足りる・抜けた語は番号なし
});
