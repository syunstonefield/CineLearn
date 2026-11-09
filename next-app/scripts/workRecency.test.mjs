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

const im = { title: 'Iron Man' };

test('復習すると上がる（その作品で初めて採点した語・SRS の updatedAt・無ければ lastReview の日付）', () => {
  const history = [row('Suits', '2026-11-05', ['a']), row('Iron Man', '2026-11-01', ['genius'])];
  const rec = workRecency({ history, srs: { genius: { origin: im, lastReview: '2026-11-07', updatedAt: '2026-11-07T03:00:00Z' } } });
  assert.deepEqual(order(rec, ['Suits', 'Iron Man']), ['Iron Man', 'Suits']);
  const rec2 = workRecency({ history, srs: { genius: { origin: im, lastReview: '2026-11-06' } } });
  assert.deepEqual(order(rec2, ['Suits', 'Iron Man']), ['Iron Man', 'Suits']);
  // 「知ってる」で飛ばしただけの語は数えない
  const rec3 = workRecency({ history, srs: { genius: { origin: im, skipped: true, updatedAt: '2026-11-07T03:00:00Z' } } });
  assert.deepEqual(order(rec3, ['Suits', 'Iron Man']), ['Suits', 'Iron Man']);
});

test('よく出る語の復習で、その語が入った全作品が上がらない（初めて採点した作品だけ）', () => {
  // like は Suits・Lupin・Iron Man の全部のリストにある。初めて採点したのは Lupin
  const history = [row('Suits', '2026-11-05', ['like']), row('Lupin', '2026-11-04', ['like']), row('Iron Man', '2026-11-01', ['like'])];
  const rec = workRecency({ history, srs: { like: { origin: { title: 'Lupin' }, lastReview: '2026-11-07', updatedAt: '2026-11-07T03:00:00Z' } } });
  assert.deepEqual(order(rec, ['Suits', 'Lupin', 'Iron Man']), ['Lupin', 'Suits', 'Iron Man']);
});

test('日付だけの値は端末のその日の0時（時刻つきの今日の操作に負けない）', () => {
  // 端末の今日（日付だけ）より、今日の朝の時刻つきの操作が上。どのタイムゾーンでも成り立つ
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const history = [row('Suits', today, ['a']), row('Iron Man', '2026-11-01', ['b'])];
  const touchedAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30).getTime(); // 今日の 0:30
  const rec = workRecency({ history, srs: {}, myDramas: [{ title: 'Iron Man', touchedAt }] });
  assert.deepEqual(order(rec, ['Suits', 'Iron Man']), ['Iron Man', 'Suits']);
});

test('拡張で保存・開いた/戻した時刻でも上がる（作品名の揺れは履歴の作品名へ寄せる）', () => {
  const history = [row('Suits', '2026-11-05', ['a']), row('Iron Man', '2026-11-01', ['b'])];
  const same = (a, b) => (a === 'Iron Man' && b === 'アイアンマン') || (a === 'アイアンマン' && b === 'Iron Man');
  const saved = workRecency({ history, srs: {}, myWords: [{ word: 'x', dramaTitle: 'アイアンマン', createdAt: '2026-11-07T01:00:00Z', savedAt: '2026-11-07' }], sameTitle: same });
  assert.deepEqual(order(saved, ['Suits', 'Iron Man']), ['Iron Man', 'Suits']);
  const opened = workRecency({ history, srs: {}, myDramas: [{ title: 'Iron Man', touchedAt: Date.parse('2026-11-06T00:00:00Z') }] });
  assert.deepEqual(order(opened, ['Suits', 'Iron Man']), ['Iron Man', 'Suits']);
});

test('同じ時刻は今までの並び（安定）', () => {
  const rec = workRecency({ history: [row('A', '2026-11-05', []), row('B', '2026-11-05', [])], srs: {} });
  assert.deepEqual(order(rec, ['A', 'B']), ['A', 'B']);
});

test('並び: saved_at の無い行（単語帳の整理で後から作られた行）や、遅れて届いた行の created_at では上がらない', () => {
  const history = [row('Suits', '2026-11-05', ['a']), row('Iron Man', '2026-11-01', ['b'])];
  const phantom = workRecency({ history, srs: {}, myWords: [{ word: 'b', dramaTitle: 'Iron Man', createdAt: '2026-11-09T15:27:57Z', savedAt: '' }] });
  assert.deepEqual(order(phantom, ['Suits', 'Iron Man']), ['Suits', 'Iron Man']);
  const late = workRecency({ history, srs: {}, myWords: [{ word: 'b', dramaTitle: 'Iron Man', createdAt: '2026-11-09T15:27:57Z', savedAt: '2026-06-07' }] });
  assert.deepEqual(order(late, ['Suits', 'Iron Man']), ['Suits', 'Iron Man']);
});
