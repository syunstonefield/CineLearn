// 意味のカテゴリ・関連語（2026-11-17）: 一覧・値の読み方・端末の中での選び方・後付けの読み取り・生成の指示。
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, CAT_VERSION, parseCatKey, catFields, catOf, catLabel, subLabel, catPromptList, catsOfWords, applyCats } from '../lib/relCategories.js';
import { relatedWords, groupByCat } from '../lib/related.js';
import { buildCatPrompt, parseCatReply, needsCat } from '../lib/server/catBackfill.js';
import { buildVocabPrompt } from '../lib/vocab.js';
import { isUsageEvent } from '../lib/usageEvents.js';

test('一覧: 大は13個・コードは重ならない・足した小分類がある', () => {
  assert.equal(CATEGORIES.length, 13);
  const keys = CATEGORIES.flatMap((c) => c.subs.map((s) => `${c.code}.${s.code}`));
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ['society.fight', 'society.military', 'science.machine', 'science.research', 'science.data', 'thinking.cause', 'state.real', 'action.split', 'emotion.calm', 'thinking.belief']) assert.ok(keys.includes(k), k);
  assert.equal(catLabel('emotion'), '感情');
  assert.equal(subLabel('emotion', 'anger'), '怒り・いらだち');
});

test('コードを読む: 一覧に無いものは other', () => {
  assert.deepEqual(parseCatKey('emotion.anger'), { cat: 'emotion', sub: 'anger' });
  assert.deepEqual(parseCatKey(' Emotion.Anger '), { cat: 'emotion', sub: 'anger' });
  for (const k of ['', null, 'other', 'emotion', 'emotion.love', 'roget.x']) assert.deepEqual(parseCatKey(k), { cat: 'other', sub: '' }, String(k));
  assert.deepEqual(catFields('time.now'), { cat: 'time', sub: 'now', catv: CAT_VERSION });
});

test('catOf: 版が違う・付いていない語は null・other はそのまま', () => {
  assert.equal(catOf({ word: 'a' }), null);
  assert.equal(catOf({ word: 'a', cat: 'emotion', sub: 'anger', catv: CAT_VERSION + 1 }), null);
  assert.equal(catOf({ word: 'a', cat: 'emotion', sub: 'nope', catv: CAT_VERSION }), null);
  assert.deepEqual(catOf({ word: 'a', cat: 'other', sub: '', catv: CAT_VERSION }), { cat: 'other', sub: '' });
});

const W = (word, k, extra = {}) => ({ word, definition: `${word}の意味`, example: `I said ${word}.`, ...catFields(k), _src: { title: '作品', season: 1, episode: 2 }, ...extra });

test('関連語: 小が同じ・学んだ語・自分以外・最近復習した順に3つまで・項目は語/意味/作品だけ', () => {
  const pool = [W('furious', 'emotion.anger'), W('annoyed', 'emotion.anger'), W('livid', 'emotion.anger'), W('irate', 'emotion.anger'), W('glad', 'emotion.joy'), W('cross', 'emotion.anger'), W('Furious', 'emotion.anger')];
  const srs = { annoyed: { lastReview: '2026-11-10' }, livid: { lastReview: '2026-11-16' }, irate: { lastReview: '2026-11-01' }, cross: { lastReview: '2026-11-12' }, glad: { lastReview: '2026-11-17' } };
  const r = relatedWords(pool[0], pool, { srs });
  assert.deepEqual(r.map((x) => x.word), ['livid', 'cross', 'annoyed']);
  assert.deepEqual(Object.keys(r[0]).sort(), ['definition', 'episode', 'season', 'title', 'type', 'word']);
  assert.equal(r[0].title, '作品');
  assert.ok(!('example' in r[0]));
  assert.deepEqual(relatedWords(W('x', 'other'), pool, { srs }), []);
  assert.deepEqual(relatedWords({ word: 'y' }, pool, { srs }), []);
  assert.equal(relatedWords(pool[0], pool, { srs, max: 1 }).length, 1);
});

test('大ごとのまとまり: 一覧の順・other と値なしは入れない', () => {
  const g = groupByCat([W('a', 'time.now'), W('b', 'emotion.joy'), W('c', 'emotion.anger'), W('d', 'other'), { word: 'e' }]);
  assert.deepEqual(g.map((x) => [x.cat, x.count]), [['emotion', 2], ['time', 1]]);
  assert.equal(g[0].label, '感情');
});

test('後付けの読み取り口: 語とコードだけを返し、history に写す', () => {
  const cats = catsOfWords([W('furious', 'emotion.anger'), W('odd', 'other'), { word: 'none', example: 'x' }]);
  assert.deepEqual(cats, [{ w: 'furious', cat: 'emotion', sub: 'anger' }, { w: 'odd', cat: 'other', sub: '' }]);
  const hist = [{ word: 'Furious' }, { word: 'odd' }, { word: 'kept', ...catFields('time.now') }, { word: 'none' }];
  assert.equal(applyCats(hist, [...cats, { w: 'kept', cat: 'emotion', sub: 'joy' }]), 2);
  assert.deepEqual([hist[0].cat, hist[0].sub, hist[0].catv], ['emotion', 'anger', CAT_VERSION]);
  assert.equal(hist[1].cat, 'other');
  assert.equal(hist[2].cat, 'time'); // もう値がある語はさわらない
  assert.equal(hist[3].cat, undefined);
});

test('後付けの指示と応答: 番号とコードだけ・読めない行は無視', () => {
  const p = buildCatPrompt([{ word: 'furious', pos: '形容詞', definition: '激怒した', example: 'He was\tfurious.' }]);
  assert.ok(p.includes('0\tfurious\t形容詞\t激怒した\tHe was furious.'));
  assert.ok(p.includes('emotion.anger（怒り・いらだち）'));
  const got = parseCatReply('0\temotion.anger\n1 other\nこれは説明\n2\tbogus.code\n9\ttime.now', 3);
  assert.deepEqual(got[0], { cat: 'emotion', sub: 'anger', catv: CAT_VERSION });
  assert.deepEqual(got[1], { cat: 'other', sub: '', catv: CAT_VERSION });
  assert.deepEqual(got[2], { cat: 'other', sub: '', catv: CAT_VERSION });
  assert.ok(needsCat({ word: 'a' }) && !needsCat(W('a', 'time.now')));
});

test('生成の指示: k と一覧が載り、辞書・分類表の名前は出さない', () => {
  const { prompt } = buildVocabPrompt({ drama: { title: 'X', type: 'tv' }, season: 1, episode: 1, subtitleText: 'hello', mode: 'superset', genVocabCount: 40, minTotal: 40, tight: true });
  assert.ok(prompt.includes('k=意味のカテゴリ'));
  assert.ok(prompt.includes(catPromptList().split('\n')[0]));
  assert.ok(prompt.includes('"k": "意味のカテゴリのコード'));
  for (const bad of ['Roget', 'WordNet', 'Longman', 'Oxford', '分類語彙表', 'シソーラス']) assert.ok(!prompt.includes(bad), bad);
});

test('利用統計: 関連語の2つは固定の名前で数えられる・カテゴリ入りの名前は数えない', () => {
  assert.ok(isUsageEvent('related_shown'));
  assert.ok(isUsageEvent('related_tap'));
  for (const k of ['related_shown_emotion', 'related_emotion_anger', 'cat_review_start']) assert.ok(!isUsageEvent(k), k);
});
