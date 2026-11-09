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

test('もう一度開いた作品で外す印: 完全一致と作品名の揺れ（寄せ方は呼び出し側）', async () => {
  const { titlesToReopen } = await import('../lib/workRemoval.js');
  const same = (a, b) => (a === 'Iron Man' && b === 'アイアンマン') || (a === 'アイアンマン' && b === 'Iron Man');
  assert.deepEqual(titlesToReopen(['Iron Man', 'Suits'], 'Iron Man'), ['Iron Man']);
  assert.deepEqual(titlesToReopen(['Iron Man', 'Suits'], 'アイアンマン', same), ['Iron Man']);
  assert.deepEqual(titlesToReopen(['Suits LA'], 'Suits'), []);
  assert.deepEqual(titlesToReopen(['Iron Man'], ''), []);
});

test('拡張で保存した作品の印を外す: 印の日より後の日に保存した語（saved_at）・作品名は完全一致だけ', async () => {
  const { titlesReopenedBySaves } = await import('../lib/workRemoval.js');
  const at = Date.parse('2026-11-07T10:00:00Z'); // 印の日（UTC）＝2026-11-07
  const marks = { 'Iron Man': { on: true, at }, Suits: { on: true, at }, Lupin: { on: false, at } };
  // 翌日以降に保存 → 外す／同じ日・前の日 → 外さない
  assert.deepEqual(titlesReopenedBySaves(marks, [{ word: 'a', dramaTitle: 'Suits', savedAt: '2026-11-08' }]), ['Suits']);
  assert.deepEqual(titlesReopenedBySaves(marks, [{ word: 'a', dramaTitle: 'Suits', savedAt: '2026-11-07' }]), []);
  assert.deepEqual(titlesReopenedBySaves(marks, [{ word: 'a', dramaTitle: 'Suits', savedAt: '2026/11/6' }]), []);
  // 作品名の揺れ（邦題）では外さない＝完全一致だけ
  assert.deepEqual(titlesReopenedBySaves(marks, [{ word: 'a', dramaTitle: 'アイアンマン', savedAt: '2026-11-09' }]), []);
  // 外れている印（on:false）は対象外・作品名の無い語は数えない
  assert.deepEqual(titlesReopenedBySaves(marks, [{ word: 'a', dramaTitle: 'Lupin', savedAt: '2026-12-01' }, { word: 'b', savedAt: '2026-12-01' }]), []);
});

test('2026-11-10 の事故の再現: 後から作られた行（created_at が新しい・saved_at は空や古い）では外さない', async () => {
  const { titlesReopenedBySaves } = await import('../lib/workRemoval.js');
  const at = Date.parse('2026-11-06T19:40:00Z');
  const marks = { 'マンダロリアン': { on: true, at }, 'Off Campus': { on: true, at } };
  const words = [
    // 整理（★の語だけにする）で作られた小文字の行: created_at は 11/10・saved_at は空・作品名は端末から引き継ぎ
    { word: 'grogu', dramaTitle: 'マンダロリアン', createdAt: '2026-11-09T15:27:57Z', savedAt: '' },
    // 拡張の未送信の語が遅れて届いた行: created_at は新しいが saved_at は古い
    { word: 'dorm', dramaTitle: 'Off Campus', createdAt: '2026-11-09T15:27:57Z', savedAt: '2026-06-07' },
  ];
  assert.deepEqual(titlesReopenedBySaves(marks, words), []);
});

test('戻した作品を一番上へ: 並びは最終学習日と戻した時刻の新しい方・戻した作品だけ touchedAt', async () => {
  const { recencyMs, touchDramas } = await import('../lib/workRemoval.js');
  const md = [{ title: 'Iron Man' }, { title: 'Suits' }];
  const now = Date.parse('2026-11-07T12:00:00Z');
  const next = touchDramas(md, ['Iron Man'], now);
  assert.equal(next[0].touchedAt, now);
  assert.equal(next[1].touchedAt, undefined);
  assert.equal(touchDramas(md, ['Lupin'], now), md); // 当たらなければ同じ配列（設定を書き直さない）
  // 最終学習日 11/03 の Suits より、11/01 に学習して今日戻した Iron Man が上
  const rows = [
    { title: 'Suits', lastDate: '2026-11-03' },
    { title: 'Iron Man', lastDate: '2026-11-01', touchedAt: now },
    { title: 'Lupin', lastDate: '2026-10-20' },
  ];
  rows.sort((a, b) => recencyMs(b.lastDate, b.touchedAt) - recencyMs(a.lastDate, a.touchedAt));
  assert.deepEqual(rows.map((r) => r.title), ['Iron Man', 'Suits', 'Lupin']);
  // 戻していない作品同士は従来どおり最終学習日の新しい順
  assert.ok(recencyMs('2026-11-03') > recencyMs('2026-11-01'));
});
