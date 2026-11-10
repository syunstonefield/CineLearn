// おすすめ（lib/recommended.js）の単体テスト。後半は検索画面の厳選リスト（2026-11-10）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRecommendations,
  RECOMMENDED,
  SEARCH_CHIPS,
  chipFilter,
  visibleChips,
  levelGroups,
  levelMark,
  normForMatch,
  matchRecommended,
} from '../lib/recommended.js';

const titles = (list) => list.map((d) => d.title);

test('おすすめ: サービス未設定（空）でも6件出る＝設定画面へ飛ばさない前提（2026-11-01）', () => {
  assert.equal(getRecommendations('B1', []).length, 6);
  assert.equal(getRecommendations('B1', undefined).length, 6);
});

test('おすすめ: サービスを選んでいればその中だけ', () => {
  const list = getRecommendations('C1', ['Amazon Prime']);
  assert.ok(list.length > 0);
  for (const d of list) assert.ok(d.services.includes('Amazon Prime'), d.title);
});

test('全作品に日本語名と理由があり、TMDB ID が重複しない', () => {
  for (const d of RECOMMENDED) {
    assert.ok(d.ja, d.title);
    assert.ok(d.reason, d.title);
  }
  assert.equal(new Set(RECOMMENDED.map((d) => d.tmdbId)).size, RECOMMENDED.length);
});

test('理由の1行に効果の言い切り・最上級を書かない（法務 2026-11-10）', () => {
  for (const d of RECOMMENDED) {
    assert.doesNotMatch(d.reason, /最適|定番中の定番|自然に身につく|自然に学べる|世界的高評価|継続しやすい|続けられる/, d.title);
  }
});

test('札：すべての作品がどれかの札に入り、0件の札は出さない', () => {
  const covered = new Set();
  for (const c of SEARCH_CHIPS) if (c.genres) chipFilter(c.key).forEach((d) => covered.add(d.title));
  assert.equal(covered.size, RECOMMENDED.length);
  assert.equal(chipFilter('all').length, RECOMMENDED.length);
  const fake = [{ title: 'X', genre: 'Comedy', level: ['B1'] }];
  assert.deepEqual(visibleChips(fake).map((c) => c.key), ['all', 'comedy']);
});

test('レベルの三段：合う→一つ上→ほか（重複も漏れもない）', () => {
  const items = [
    { title: 'a', level: ['A2', 'B1'] },
    { title: 'b', level: ['B2'] },
    { title: 'c', level: ['C1'] },
    { title: 'd', level: ['A2'] },
  ];
  const g = levelGroups(items, 'B1', true);
  assert.deepEqual(g.map((x) => [x.key, titles(x.items)]), [
    ['fit', ['a']],
    ['stretch', ['b']],
    ['other', ['c', 'd']],
  ]);
  const all = levelGroups(RECOMMENDED, 'B2', true).flatMap((x) => x.items);
  assert.equal(all.length, RECOMMENDED.length);
});

test('レベルの二段：合う／それ以外。C1 は一つ上が無い・未設定は B1 扱い', () => {
  const items = [{ title: 'a', level: ['B1'] }, { title: 'b', level: ['C1'] }];
  assert.deepEqual(levelGroups(items, 'B1', false).map((x) => [x.key, titles(x.items)]), [
    ['fit', ['a']],
    ['stretch', ['b']],
  ]);
  assert.deepEqual(levelGroups(items, 'C1', true).map((x) => x.key), ['fit', 'other']);
  assert.deepEqual(levelGroups(items, undefined, true).map((x) => x.key), ['fit', 'other']); // B1 の一つ上は B2
});

test('レベルの印：利用者のレベルを含めばそれ、無ければ一番低いレベル', () => {
  assert.equal(levelMark({ level: ['B2', 'C1'] }, 'C1'), 'C1');
  assert.equal(levelMark({ level: ['B2', 'C1'] }, 'B1'), 'B2');
});

test('照合の寄せ：ひらがな→カタカナ・全角・記号・空白', () => {
  assert.equal(normForMatch('ふれんず'), normForMatch('フレンズ'));
  assert.equal(normForMatch('ＳＵＩＴＳ'), 'suits');
  assert.equal(normForMatch("Grey's Anatomy"), 'greysanatomy');
});

test('打っている途中の候補：英語名・日本語名・ひらがな・The 抜き', () => {
  assert.deepEqual(titles(matchRecommended('ふれ')), ['Friends']);
  assert.deepEqual(titles(matchRecommended('suits')), ['Suits']);
  assert.deepEqual(titles(matchRecommended('シャーロック')), ['Sherlock']);
  assert.deepEqual(titles(matchRecommended('office')), ['The Office']);
  assert.deepEqual(titles(matchRecommended('ビッグバン')), ['The Big Bang Theory']);
  assert.deepEqual(matchRecommended('s'), []); // 1文字は出さない
  assert.ok(matchRecommended('the').length <= 5); // 最大5件
});
