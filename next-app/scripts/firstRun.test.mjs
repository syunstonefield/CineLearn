import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startupAuth, firstRunScreen, shouldClearSeenFlagsOnSignup, trialSourceOf } from '../lib/firstRun.js';

test('未ログインの起動: 新規・既存ゲストにログイン画面を出さない', () => {
  assert.deepEqual(startupAuth({ hadSession: false, extEntry: false }), { expired: false, openAuth: false, mode: null });
});

test('未ログインの起動: 期限切れは帯の案内だけ（モーダルなし）', () => {
  assert.deepEqual(startupAuth({ hadSession: true, extEntry: false, hasProfiles: true }), { expired: true, openAuth: false, mode: null });
});

test('未ログインの起動: 期限切れでプロフィールが無い人はログインを先に', () => {
  assert.deepEqual(startupAuth({ hadSession: true, extEntry: false, hasProfiles: false }), { expired: true, openAuth: true, mode: 'login' });
});

test('未ログインの起動: 拡張から来た人は登録を先に・ログイン歴があればログインのタブ', () => {
  assert.deepEqual(startupAuth({ hadSession: false, extEntry: true }), { expired: false, openAuth: true, mode: 'signup' });
  assert.deepEqual(startupAuth({ hadSession: true, extEntry: true }), { expired: true, openAuth: true, mode: 'login' });
});

test('行き先: 既存のログイン済み・既存ゲスト（完了済み）はホームのまま', () => {
  assert.equal(firstRunScreen({ onboarded: true, loggedIn: true }), 'main');
  assert.equal(firstRunScreen({ onboarded: true, loggedIn: false }), 'main');
  // クラウドで settings.onboarded が消えても、端末の既読があれば出さない（既存の防御）
  assert.equal(firstRunScreen({ onboarded: false, onboardedSeen: true, loggedIn: true }), 'main');
  assert.equal(firstRunScreen({ onboarded: false, trialDone: true, loggedIn: false }), 'main');
});

test('行き先: 期限切れは新規扱いにしない', () => {
  assert.equal(firstRunScreen({ onboarded: false, loggedIn: false, expired: true }), 'main');
});

test('体験の source: 拡張から来て登録した人だけ extension', () => {
  assert.equal(trialSourceOf({ extEntry: true, loggedIn: true }), 'extension');
  assert.equal(trialSourceOf({ extEntry: true, loggedIn: false }), 'new');
  assert.equal(trialSourceOf({ extEntry: false, loggedIn: true }), 'new');
});

test('行き先: 新規ゲスト・途中で閉じたゲスト・新規アカウントは体験', () => {
  assert.equal(firstRunScreen({ onboarded: false, loggedIn: false }), 'trial');
  assert.equal(firstRunScreen({ onboarded: false, loggedIn: false, trialPending: true }), 'trial');
  assert.equal(firstRunScreen({ onboarded: false, loggedIn: true, trialPending: true }), 'trial');
});

test('行き先: 体験の印が無いアンケート未完了のログイン済みアカウントは旧アンケートのまま', () => {
  assert.equal(firstRunScreen({ onboarded: false, loggedIn: true }), 'onboarding');
});

test('新規登録の印の消去: 前のアカウントの残りの印は消す（既存の意図）', () => {
  assert.equal(shouldClearSeenFlagsOnSignup({ inTrial: false, onboarded: false }), true);
});

test('新規登録の印の消去: 体験中・体験後・利用中のゲストは消さない（旧アンケートと使い方を復活させない）', () => {
  assert.equal(shouldClearSeenFlagsOnSignup({ inTrial: true, onboarded: false }), false);
  assert.equal(shouldClearSeenFlagsOnSignup({ inTrial: false, onboarded: true }), false);
});
