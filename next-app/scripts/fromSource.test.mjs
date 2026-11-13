// 入口の印 ?from=（2026-11-13）: 決まった値だけ・紹介ページだけの行を今までの表に入れない・入口別の表。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fromEvent, isUsageEvent, FROM_SOURCES } from '../lib/usageEvents.js';
import { buildUsageReport, buildFromTable, isLandingOnlyRow, weekWindows } from '../lib/usageReport.js';

test('決まった値だけを from_<値> にする', () => {
  assert.deepEqual(FROM_SOURCES, ['tiktok', 'youtube', 'share']);
  assert.equal(fromEvent('tiktok'), 'from_tiktok');
  assert.equal(fromEvent(' YouTube '), 'from_youtube');
  assert.equal(fromEvent('share'), 'from_share');
  for (const v of ['ext_install', 'x', '', null, 'tiktok123', 'tik tok']) assert.equal(fromEvent(v), null, String(v));
  for (const k of ['from_tiktok', 'from_youtube', 'from_share']) assert.ok(isUsageEvent(k), k);
  for (const k of ['from_ext_install', 'from_x', 'from_']) assert.ok(!isUsageEvent(k), k);
});

const row = (day, p, d, c, extra = {}) => ({ day, p, d, L: p !== d, c, ...extra });

test('紹介ページだけの行は今までの表（開いた人・新規の人）に入れない', () => {
  assert.ok(isLandingOnlyRow(row('2026-11-12', 'g1', 'g1', { from_tiktok: 1 })));
  assert.ok(!isLandingOnlyRow(row('2026-11-12', 'g1', 'g1', { from_tiktok: 1, open: 1 })));
  assert.ok(!isLandingOnlyRow(row('2026-11-12', 'g1', 'g1', {})));
  const rows = [row('2026-11-12', 'g1', 'g1', { from_tiktok: 1 }), row('2026-11-12', 'g2', 'g2', { open: 1 })];
  const rep = buildUsageReport(rows, { today: '2026-11-13', weeks: 1 });
  assert.equal(rep.plus[0]['開いた人'], 1);
  assert.equal(rep.newUsers[0]['新規の人'], 1);
});

test('入口別: ゲストで来て後の日にログインしても同じ人として数える', () => {
  const rows = [
    // 端末 d1: TikTok から紹介ページ → 同じ日に /app を開いて作品を選ぶ（ゲスト）
    row('2026-11-10', 'd1', 'd1', { from_tiktok: 1, open: 1, work_select: 1 }),
    // 次の日に同じ端末でログイン → 単語を学ぶ
    row('2026-11-11', 'u1', 'd1', { open: 1, learn_start: 1, auth_signup: 1 }),
    // 端末 d2: YouTube から紹介ページだけ見て帰った
    row('2026-11-12', 'd2', 'd2', { from_youtube: 1 }),
    // 端末 d3: 印なしで来た人は入口別に入らない
    row('2026-11-12', 'd3', 'd3', { open: 1, work_select: 1 }),
  ];
  const rep = buildUsageReport(rows, { today: '2026-11-13', weeks: 1 });
  const tk = rep.from.find((r) => r['入口'] === 'tiktok');
  assert.equal(tk['来た回数'], 1);
  assert.equal(tk['初めて来た人'], 1);
  assert.equal(tk['アプリを開いた'], '1 100%');
  assert.equal(tk['作品を選んだ'], '1 100%');
  assert.equal(tk['単語を学ぶを始めた'], '1 100%');
  assert.equal(tk['新規登録'], '1 100%');
  assert.equal(tk['別の日にも開いた'], '1 100%');
  const yt = rep.from.find((r) => r['入口'] === 'youtube');
  assert.equal(yt['初めて来た人'], 1);
  assert.equal(yt['アプリを開いた'], '0 0%');
  assert.ok(!rep.from.some((r) => r['入口'] === 'share'));
});

test('入口は最初に来た時の値（あとで別の値で来ても変えない）・印より前の行は数えない', () => {
  const rows = [
    row('2026-11-08', 'd1', 'd1', { open: 1, work_select: 1 }),
    row('2026-11-10', 'd1', 'd1', { from_youtube: 1, open: 1 }),
    row('2026-11-12', 'd1', 'd1', { from_tiktok: 1, open: 1 }),
  ];
  const t = buildFromTable(rows, weekWindows('2026-11-13', 1));
  const yt = t.find((r) => r['入口'] === 'youtube');
  const tk = t.find((r) => r['入口'] === 'tiktok');
  assert.equal(yt['初めて来た人'], 1);
  assert.equal(yt['作品を選んだ'], '0 0%');
  assert.equal(tk['来た回数'], 1);
  assert.equal(tk['初めて来た人'], 0);
});

test('まだ誰も来ていない時は1行だけ', () => {
  const t = buildFromTable([row('2026-11-12', 'd1', 'd1', { open: 1 })], weekWindows('2026-11-13', 2));
  assert.equal(t.length, 1);
  assert.equal(t[0]['入口'], '（まだ無し）');
});
