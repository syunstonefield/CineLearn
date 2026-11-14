// 復習カードの利用データ（2026-11-07・法務の条件つき）のテスト。
//   名前は固定の一覧だけ・時間は幅だけ・途中離脱は exit_review_… の形。週次の⑩に出る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUsageEvent, reviewTimeEvent, exitEventName, parseExitEvent, REVIEW_TIME_BUCKETS, USAGE_EVENTS } from '../lib/usageEvents.js';
import { buildUsageReport } from '../lib/usageReport.js';

test('復習の名前は一覧に入っていて、語や番号の入った名前は通らない', () => {
  for (const k of ['review_start', 'review_done', 'review_ans_fail', 'review_ans_hard', 'review_ans_easy']) assert.ok(isUsageEvent(k), k);
  for (const [k] of REVIEW_TIME_BUCKETS) assert.ok(USAGE_EVENTS.includes(k), k);
  assert.ok(!isUsageEvent('review_ans_easy:verdict'));
  assert.ok(!isUsageEvent('review_t_7'));
  assert.ok(!isUsageEvent('exit_review_3_later_x'));
});

test('1枚の時間は4つの幅だけ（生の秒数は出さない）', () => {
  assert.equal(reviewTimeEvent(0), 'review_t_0_5');
  assert.equal(reviewTimeEvent(4.99), 'review_t_0_5');
  assert.equal(reviewTimeEvent(5), 'review_t_5_10');
  assert.equal(reviewTimeEvent(19.9), 'review_t_10_20');
  assert.equal(reviewTimeEvent(20), 'review_t_20p');
  assert.equal(reviewTimeEvent(3600), 'review_t_20p');
  assert.equal(reviewTimeEvent(-1), null);
  assert.equal(reviewTimeEvent('x'), null);
});

test('途中離脱は exit_review_<何割>_<x|nav|close> の形', () => {
  const name = exitEventName('review', 4, 'x');
  assert.equal(name, 'exit_review_4_x');
  assert.ok(isUsageEvent(name));
  assert.deepEqual(parseExitEvent('exit_review_10_nav'), { stage: 'review', decile: 10, how: 'nav' });
});

test('週次の⑩: 完了の割合・抜けた回数・答えと時間の割合', () => {
  const row = (p, c) => ({ day: '2026-11-07', p, d: p, L: 1, c, r: null });
  const rows = [
    row('a', { review_start: 2, review_done: 1, exit_review_4_x: 1, review_ans_fail: 1, review_ans_hard: 1, review_ans_easy: 2, review_t_0_5: 2, review_t_5_10: 2 }),
    row('b', { review_start: 2, review_done: 2, review_ans_easy: 4, review_t_10_20: 4 }),
  ];
  const rep = buildUsageReport(rows, { today: '2026-11-07', weeks: 1 });
  const [w] = rep.reviewFlow;
  assert.equal(w.始めた人, 2);
  assert.equal(w.始めた回, 4);
  assert.equal(w.終えた回, '3 75%');
  assert.equal(w.途中で抜けた回, 1);
  assert.equal(w.知らなかった, '13%');
  assert.equal(w.知ってた, '75%');
  assert.equal(w['5〜10秒'], '25%');
  assert.equal(w['10〜20秒'], '50%');
  const ex = rep.exits.find((e) => e.段階 === '⑩復習のカード');
  assert.equal(ex.計, 1);
  assert.equal(ex['2-4割'], 1);
  assert.equal(ex['✕'], 1);
});

// 2026-11-14 抜けた理由の見分け（めくる前/後・はじめての語/期限の語・時間の幅・下のタブの行き先・始めた時の内訳の幅）
test('抜けた理由の名前は固定の一覧だけ・行き先は決まった6つだけ', async () => {
  const { reviewExitDetailEvents, reviewMixEvents, reviewExitTimeEvent, REVIEW_EXIT_EVENTS } = await import('../lib/usageEvents.js');
  for (const k of REVIEW_EXIT_EVENTS) assert.ok(isUsageEvent(k), k);
  assert.deepEqual(reviewExitDetailEvents({ flipped: false, isNew: true, sec: 3, how: 'nav', target: 'home' }), ['review_exit_front', 'review_exit_new', 'review_exit_t_0_5', 'review_nav_home']);
  assert.deepEqual(reviewExitDetailEvents({ flipped: true, isNew: false, sec: 70, how: 'x', target: 'home' }), ['review_exit_back', 'review_exit_due', 'review_exit_t_60p']);
  assert.deepEqual(reviewExitDetailEvents({ flipped: false, isNew: false, sec: 20, how: 'nav', target: 'profile' }), ['review_exit_front', 'review_exit_due', 'review_exit_t_15_60']);
  assert.equal(reviewExitTimeEvent(5), 'review_exit_t_5_15');
  assert.equal(reviewExitTimeEvent(14.9), 'review_exit_t_5_15');
  assert.equal(reviewExitTimeEvent(-1), null);
  assert.deepEqual(reviewMixEvents(0, 20), ['review_mix_new_0', 'review_mix_due_11_20']);
  assert.deepEqual(reviewMixEvents(5, 6), ['review_mix_new_1_5', 'review_mix_due_6_10']);
  assert.deepEqual(reviewMixEvents(21, 1), ['review_mix_new_21p', 'review_mix_due_1_5']);
  assert.ok(!isUsageEvent('review_nav_journey'));
  assert.ok(isUsageEvent('review_nav_settings'));
  assert.ok(!isUsageEvent('review_mix_new_3'));
});

test('週次の⑩の下: 抜けた時の内訳と始めた時の内訳は回数で出る', () => {
  const row = (p, c) => ({ day: '2026-11-14', p, d: p, L: 1, c, r: null });
  const rows = [
    row('a', { review_start: 2, exit_review_0_nav: 1, exit_review_1_x: 1, review_exit_front: 2, review_exit_new: 2, review_exit_t_0_5: 1, review_exit_t_5_15: 1, review_nav_home: 1, review_mix_new_11_20: 2, review_mix_due_0: 2 }),
    row('b', { review_start: 1, review_mix_new_0: 1, review_mix_due_1_5: 1 }),
  ];
  const rep = buildUsageReport(rows, { today: '2026-11-14', weeks: 1 });
  const [e] = rep.reviewExit;
  assert.equal(e.抜けた回, 2);
  assert.equal(e.めくる前, 2);
  assert.equal(e.めくった後, 0);
  assert.equal(e.はじめての語, 2);
  assert.equal(e['→ホーム'], 1);
  assert.equal(e['〜5秒'], 1);
  const [m] = rep.reviewMix;
  assert.equal(m.始めた回, 3);
  assert.equal(m['はじめて11-20'], 2);
  assert.equal(m['はじめて0'], 1);
  assert.equal(m['期限0'], 2);
  assert.equal(m['期限1-5'], 1);
});
