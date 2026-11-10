// スライド式チュートリアルとボタン案内（lib/introTour.js）・利用統計の項目（lib/usageEvents.js・lib/usageReport.js）の単体テスト。
import assert from 'node:assert/strict';
import { tourSteps, TOUR_STEPS, lastTipAction, shouldGlowAdd, tipPosition, spotRect, INTRO_SLIDES, FIRST_RUN_MODE } from '../lib/introTour.js';
import { isUsageEvent } from '../lib/usageEvents.js';
import { buildUsageReport, INTRO_STEPS } from '../lib/usageReport.js';

const ALL = TOUR_STEPS.map((s) => s.key);
let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log('ok', name);
};

t('既定はスライド式（NEXT_PUBLIC_FIRST_RUN 未設定）', () => {
  assert.equal(FIRST_RUN_MODE, process.env.NEXT_PUBLIC_FIRST_RUN === 'trial' ? 'trial' : 'intro');
});

t('9か所の並び順（ヘッダー右の4つ → 下のタブ5つ）', () => {
  assert.deepEqual(ALL, ['add', 'settings', 'help', 'login', 'home', 'wordbook', 'review', 'journey', 'collection']);
});

t('未ログインで全部ある時は9か所', () => {
  assert.equal(tourSteps({ loggedIn: false, present: ALL }).length, 9);
});

t('ログイン済みは4番（ログイン）を飛ばす', () => {
  const keys = tourSteps({ loggedIn: true, present: ALL }).map((s) => s.key);
  assert.equal(keys.length, 8);
  assert.ok(!keys.includes('login'));
});

t('あゆみのタブが出ない人は8番を飛ばす', () => {
  const keys = tourSteps({ loggedIn: false, present: ALL.filter((k) => k !== 'journey') }).map((s) => s.key);
  assert.equal(keys.length, 8);
  assert.ok(!keys.includes('journey'));
});

t('画面に無いボタンは飛ばし、並び順は保つ', () => {
  const keys = tourSteps({ present: new Set(['collection', 'add', 'home']) }).map((s) => s.key);
  assert.deepEqual(keys, ['add', 'home', 'collection']);
});

t('最後の札：作品が無い人だけ作品追加へ', () => {
  assert.deepEqual(lastTipAction({ hasWorks: false }), { label: '作品を選んではじめる', add: true });
  assert.deepEqual(lastTipAction({ hasWorks: true }), { label: 'はじめる', add: false });
});

t('＋ を光らせるのは、一度も押していない端末で、作品追加へ進まなかった時だけ', () => {
  assert.equal(shouldGlowAdd({}), true);
  assert.equal(shouldGlowAdd({ addUsed: true }), false);
  assert.equal(shouldGlowAdd({ wentToAdd: true }), false);
});

t('札の位置：ヘッダーのボタンは下・画面の右端から離す', () => {
  const p = tipPosition({ rect: { left: 342, top: 13, width: 32, height: 32 }, vw: 390, vh: 844, tipW: 290, tipH: 150 });
  assert.equal(p.below, true);
  assert.equal(p.left, 390 - 12 - 290);
  assert.equal(p.top, 13 + 32 + 14);
});

t('札の位置：下のタブは上に出し、タブにかからない', () => {
  const r = { left: 0, top: 788, width: 78, height: 56 };
  const p = tipPosition({ rect: r, vw: 390, vh: 844, tipW: 290, tipH: 150 });
  assert.equal(p.below, false);
  assert.equal(p.left, 12);
  assert.ok(p.top + 150 <= r.top);
});

t('札はポスターにかからない位置までずらす（下のタブ＝上へ）', () => {
  const r = { left: 156, top: 788, width: 78, height: 56 };
  const poster = { left: 0, right: 390, top: 408, bottom: 683 };
  const p = tipPosition({ rect: r, vw: 390, vh: 844, tipW: 290, tipH: 120, avoid: [poster] });
  assert.equal(p.overlap, false);
  assert.ok(p.top + 120 <= poster.top - 4, String(p.top));
});

t('札はポスターにかからない位置までずらす（ヘッダー＝下へ）', () => {
  const r = { left: 232, top: 12, width: 34, height: 34 };
  const poster = { left: 0, right: 390, top: 70, bottom: 300 };
  const p = tipPosition({ rect: r, vw: 390, vh: 844, tipW: 290, tipH: 120, avoid: [poster] });
  assert.equal(p.overlap, false);
  assert.ok(p.top >= poster.bottom + 4);
});

t('どこにも置けない時はボタンのそばに置き、overlap を返す', () => {
  const r = { left: 0, top: 788, width: 78, height: 56 };
  const p = tipPosition({ rect: r, vw: 390, vh: 844, tipW: 290, tipH: 120, avoid: [{ left: 0, right: 390, top: 0, bottom: 770 }] });
  assert.equal(p.overlap, true);
  assert.equal(p.top, 788 - 14 - 120);
});

t('明かりはボタンより少し広い', () => {
  assert.deepEqual(spotRect({ left: 10, top: 20, width: 30, height: 40 }, 5), { left: 5, top: 15, width: 40, height: 50 });
});

t('スライドは6枚（ようこそ／単語リスト／復習／クイズ／コレクション／拡張機能）', () => {
  assert.deepEqual(INTRO_SLIDES.map((s) => s.key), ['cover', 'list', 'review', 'quiz', 'frames', 'ext']);
  assert.equal(INTRO_SLIDES[3].p, 'セリフの空欄に入る語を、4択で。');
});

t('利用統計：新しい項目は受け付け、値を足した名前は受け付けない', () => {
  for (const [k] of INTRO_STEPS) assert.ok(isUsageEvent(k), k);
  for (const k of ['intro_level_b1', 'tour_step_3', 'intro_s7', 'tour_add_37680']) assert.ok(!isUsageEvent(k), k);
});

t('集計：⑪ スライド式の流れ（ようこそに対する%）', () => {
  const row = (day, p, c) => ({ day, p, d: p, L: 0, c: { open: 1, ...c }, r: null });
  const rep = buildUsageReport(
    [
      row('2026-11-10', 'a', { intro_start: 1, intro_s2: 1, intro_s6: 1, intro_guest: 1, intro_level: 1, tour_start: 1, tour_done: 1, tour_add: 1 }),
      row('2026-11-10', 'b', { intro_start: 1, intro_skip: 1, intro_level: 1, tour_start: 1, tour_skip: 1 }),
    ],
    { today: '2026-11-10' }
  );
  const w = rep.intro[0];
  assert.equal(w['ようこそ'], '2人 / 2回');
  assert.match(w['レベル'], /^2人 100%/);
  assert.match(w['案内を最後まで'], /^1人 50%/);
  assert.match(w['案内から作品追加'], /^1人 50%/);
});

console.log(`${n} tests passed`);
