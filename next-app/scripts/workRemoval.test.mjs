// コレクションから作品を消去（lib/workRemoval.js・2026-11-07）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWorkRemoval, removalConfirmLines, ringMetValue, metAfterRemoval, isPrunedRow, removedTitlesOf, withRemoved } from '../lib/workRemoval.js';
import { mergeTitleToggles, mergeRingMetReset } from '../lib/stateMergeRules.js';
import { isLearned, isMastered, buildLibraryEntries } from '../lib/storage.js';
import { STATE_KEY_RE } from '../lib/supabase.js';

const w = (word) => ({ word, definition: 'd', example: 'e' });
const row = (id, title, words, s = 1, e = 1) => ({ id, drama: { title, genre: 'Drama' }, season: s, episode: e, words: words.map(w), date: '2026-11-01' });
const learned = { repetitions: 2, interval: 6, easeFactor: 2.5 };
const mastered = { repetitions: 3, interval: 21, easeFactor: 2.5 };
const once = { repetitions: 0, interval: 1, easeFactor: 2.3 }; // 1回採点（「もう一度」）
const plan = (o) => planWorkRemoval({ isLearned, isMastered, now: 1000, ...o });

test('消える語＝学習していない・他のリストにも単語帳にも無い語だけ', () => {
  const history = [
    row('1', 'Suits', ['alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta', 'skip']),
    row('2', 'Suits', ['alpha', 'theta'], 1, 2),
    row('3', 'Friends', ['beta', 'other']),
  ];
  const srs = { gamma: once, delta: learned, eps: mastered, skip: { skipped: true } };
  const myWords = [{ word: 'Zeta' }];
  const p = plan({ title: 'Suits', history, myWords, srs });
  // alpha・theta＝消える、beta＝Friends に残る、gamma/delta/eps＝採点済み、zeta＝単語帳、skip＝数に入らない
  assert.deepEqual(p.counts, { removed: 2, shared: 1, studied: 3, learned: 2, mastered: 1, wordbook: 1 });
  assert.equal(p.episodes, 2);
  // 行1は学習した語だけ残す（印つき）・行2は何も残らない＝削除・Friends は触らない
  assert.deepEqual(p.rowsDelete, ['2']);
  assert.equal(p.rowsUpdate.length, 1);
  assert.deepEqual(p.rowsUpdate[0].words.map((x) => x.word), ['gamma', 'delta', 'eps', 'zeta']);
  assert.equal(p.rowsUpdate[0].drama.prunedAt, 1000);
  assert.equal(p.rowsUpdate[0].drama.title, 'Suits');
  assert.ok(isPrunedRow(p.rowsUpdate[0]));
  assert.deepEqual(p.nextHistory.map((h) => h.id), ['1', '3']);
  assert.equal(p.nextHistory[1], history[2]);
  assert.ok(p.changed);
});

test('学習した語は意味・例文ごと残る（復習と円に出続ける）', () => {
  const history = [row('1', 'Suits', ['keep', 'drop'])];
  const p = plan({ title: 'Suits', history, myWords: [], srs: { keep: learned } });
  assert.deepEqual(p.nextHistory[0].words, [w('keep')]);
});

test('作品名は完全一致（Suits で Suits LA を巻き込まない）', () => {
  const history = [row('1', 'Suits LA', ['a']), row('2', 'Suits', ['b'])];
  const p = plan({ title: 'Suits', history, myWords: [], srs: {} });
  assert.deepEqual(p.nextHistory.map((h) => h.id), ['1']);
});

test('もう一度抜いても変わらない（取り込みのたびに当て直せる）', () => {
  const history = [row('1', 'Suits', ['keep', 'drop'])];
  const srs = { keep: learned };
  const p1 = plan({ title: 'Suits', history, myWords: [], srs });
  const p2 = plan({ title: 'Suits', history: p1.nextHistory, myWords: [], srs });
  assert.equal(p2.changed, false);
  assert.deepEqual(p2.counts.removed, 0);
});

test('単語リストの無い作品（マイリストだけ）でも消去できる＝行は変えない', () => {
  const p = plan({ title: 'Lupin', history: [row('1', 'Suits', ['a'])], myWords: [], srs: {} });
  assert.equal(p.changed, false);
  assert.equal(p.episodes, 0);
});

test('確認画面の文：件数つき・0 の項目は書かない', () => {
  assert.deepEqual(removalConfirmLines({ removed: 74, shared: 6, studied: 19, learned: 12, mastered: 3, wordbook: 4 }), [
    '消去する語：74語（ほかの作品の単語リストにもある 6語は残ります）',
    '残る語：学習した 19語（覚えた 12・マスター 3 を含む）と、単語帳の 4語。復習もこれまでどおり続きます',
    '学習した日・EXP・覚えた・マスターの記録はそのままです（あゆみの「出会った」は消去した語の分だけ減ります）',
    '作品をもう一度開けば、単語リストはいつでも作り直せます',
  ]);
  const none = removalConfirmLines({ removed: 30, shared: 0, studied: 0, learned: 0, mastered: 0, wordbook: 0 });
  assert.equal(none[0], '消去する語：30語');
  assert.equal(none[1], '残る語：ありません');
  assert.equal(removalConfirmLines({ removed: 1, shared: 0, studied: 2, learned: 0, mastered: 0, wordbook: 0 })[1], '残る語：学習した 2語。復習もこれまでどおり続きます');
});

test('消した印: 作品ごとに新しい方が勝つ（開き直した印も別の端末に届く）', () => {
  const removed = withRemoved({}, 'Suits', true, 100);
  assert.deepEqual(removedTitlesOf(removed), ['Suits']);
  const reopened = withRemoved(removed, 'Suits', false, 200);
  assert.deepEqual(removedTitlesOf(mergeTitleToggles(removed, reopened)), []);
  assert.deepEqual(removedTitlesOf(mergeTitleToggles(reopened, removed)), []);
  assert.deepEqual(removedTitlesOf(mergeTitleToggles({ A: { on: true, at: 5 } }, { B: { on: true, at: 6 } })).sort(), ['A', 'B']);
});

test('円の「出会った」: 消去の後はその時点からの最高値・消去が無ければ従来の最高値', () => {
  assert.equal(ringMetValue({ current: 80, highWater: 200, reset: null }), 200);
  assert.equal(ringMetValue({ current: 80, highWater: 200, reset: { at: 1, met: 0 } }), 80);
  assert.equal(ringMetValue({ current: 80, highWater: 200, reset: { at: 1, met: 90 } }), 90);
  // 起点＝直前に見えていた値 − 消えた語数（端末の履歴が50話までで、今の値が最高値より小さくても、消えた分だけ減る）
  assert.equal(metAfterRemoval(500, 10), 490);
  assert.equal(metAfterRemoval(5, 10), 0);
  assert.equal(ringMetValue({ current: 12, highWater: 500, reset: { at: 2, met: metAfterRemoval(500, 10) } }), 490);
  // 新しい消去が勝つ・同じ消去なら大きい方
  assert.deepEqual(mergeRingMetReset({ at: 2, met: 10 }, { at: 1, met: 99 }), { at: 2, met: 10 });
  assert.deepEqual(mergeRingMetReset({ at: 1, met: 10 }, { at: 1, met: 30 }), { at: 1, met: 30 });
  assert.deepEqual(mergeRingMetReset(null, { at: 1, met: 3 }), { at: 1, met: 3 });
});

test('コレクション・ホームの一覧から消した作品を隠す（マイリストに残っていても）', () => {
  const history = [row('1', 'Suits', ['a']), row('2', 'Friends', ['b'])];
  const lib = buildLibraryEntries(history, [{ title: 'Suits' }, { title: 'Lupin' }], ['Suits']);
  assert.deepEqual(lib.map((e) => e.drama.title).sort(), ['Friends', 'Lupin']);
});

test('消した印と円の起点はクラウドに同期する項目', () => {
  assert.ok(STATE_KEY_RE.test('cl_removed_works'));
  assert.ok(STATE_KEY_RE.test('cl_ring_met_reset'));
});
