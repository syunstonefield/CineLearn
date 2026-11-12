// 2026-11-12: 単語リストの履歴を行数（50行）ではなく大きさ（2MB）で残す・外す順・クラウドの取り込みのページ送り・
//   覚えた／マスターの合計に SRS の語も入れる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimHistoryToBudget, rowHasGradedWord, HISTORY_BUDGET_CHARS } from '../lib/historyBudget.js';
import { fetchHistoryForPull, historyRowToLocal } from '../lib/supabase.js';
import { overallVocabStats, collectRingWords } from '../lib/storage.js';

const row = (id, date, words) => ({ id, date, drama: { title: `Work ${id}` }, season: 1, episode: 1, words: words.map((w) => ({ word: w, definition: 'x'.repeat(50) })) });

test('上限内なら何も外さない（50行を超えても大きさが収まれば残す）', () => {
  const h = Array.from({ length: 80 }, (_, i) => row(String(i), '2026-11-01', ['a' + i]));
  const r = trimHistoryToBudget(h, {});
  assert.equal(r.history.length, 80);
  assert.deepEqual(r.dropped, []);
  assert.equal(HISTORY_BUDGET_CHARS, 2_000_000);
});

test('超えたら、採点した語の無い行を古い順に先に外す・採点した語のある行は後・今保存した行は外さない', () => {
  const srs = { learned1: { repetitions: 2 }, skipped1: { skipped: true } };
  const h = [
    row('new', '2026-11-12', ['fresh']), // 今保存した行（一番古くなくても keepIds で守る）
    row('g-old', '2026-01-01', ['learned1']), // 採点あり・一番古い
    row('u-mid', '2026-05-01', ['plain']), // 採点なし
    row('u-old', '2026-03-01', ['skipped1']), // 「知ってる」だけ＝採点なし扱い
  ];
  const one = JSON.stringify(h[1]).length + 1;
  const budget = h.reduce((a, x) => a + JSON.stringify(x).length + 1, 2) - one; // 1行ぶん超える
  const r = trimHistoryToBudget(h, srs, { budget, keepIds: ['new'] });
  assert.deepEqual(r.dropped, ['u-old']); // 採点なしの一番古い行
  const r2 = trimHistoryToBudget(h, srs, { budget: budget - one + 20, keepIds: ['new'] });
  assert.deepEqual(r2.dropped.sort(), ['u-mid', 'u-old']); // 採点なしを全部外してから
  const r3 = trimHistoryToBudget(h, srs, { budget: 10, keepIds: ['new'] });
  assert.deepEqual(r3.history.map((x) => x.id), ['new']); // 採点ありも最後に外す・new は残る
  assert.equal(rowHasGradedWord(h[1], srs), true);
  assert.equal(rowHasGradedWord(h[3], srs), false);
});

test('取り込み: 100行ずつページ送り・最後のページで止まる・途中の失敗は null（上書きしない）', async () => {
  const cloud = Array.from({ length: 230 }, (_, i) => ({ id: String(i), words: [] }));
  const calls = [];
  const page = async (path) => {
    calls.push(path);
    const off = Number(/offset=(\d+)/.exec(path)[1]);
    return cloud.slice(off, off + 100);
  };
  const all = await fetchHistoryForPull('u1', page);
  assert.equal(all.length, 230);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /limit=100&offset=0/);
  let n = 0;
  const flaky = async (path) => (n++ === 1 ? null : cloud.slice(0, 100));
  assert.equal(await fetchHistoryForPull('u1', flaky), null);
  assert.deepEqual(historyRowToLocal({ id: '1', target_level: 'B2', quiz_score: 80, quiz_date: 'd', words: [] }).targetLevel, 'B2');
});

test('覚えた／マスターの合計: 履歴から押し出された作品の採点済みの語も数える・「知ってる」で飛ばした語は数えない', () => {
  const history = [row('1', '2026-11-01', ['alpha'])];
  const srs = {
    alpha: { repetitions: 0, interval: 1 },
    gone: { repetitions: 5, interval: 30, origin: { title: 'Spider-Man: Homecoming' } }, // 押し出された作品の語
    skippedonly: { skipped: true },
  };
  const s = overallVocabStats(history, [], srs, null);
  assert.equal(s.total, 2);
  const ring = collectRingWords(history, [], srs);
  const keys = ring.map((w) => w.key).sort();
  assert.deepEqual(keys, ['alpha', 'gone']);
  assert.equal(ring.find((w) => w.key === 'gone').title, 'Spider-Man: Homecoming');
});
