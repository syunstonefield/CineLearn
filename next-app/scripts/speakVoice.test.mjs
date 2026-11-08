// 読み上げの声選び（lib/speak.js pickVoiceFrom）。2026-11-08 オーナーの PC（macOS・Chrome・既定 Kyoko）で
// Albert（おもしろ音声）が選ばれ「ホラーみたいにかすれた声」になった件の再発防止。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickVoiceFrom } from '../lib/speak.js';

const V = (name, lang, extra = {}) => ({ name, lang, default: false, localService: true, ...extra });

// オーナーの実データの先頭（既定は日本語の Kyoko・英語の既定なし）
const macOwner = [
  V('Kyoko', 'ja-JP', { default: true }),
  V('Albert', 'en-US'), V('Bad News', 'en-US'), V('Bahh', 'en-US'), V('Boing', 'en-US'), V('Bubbles', 'en-US'),
  V('Cellos', 'en-US'), V('Daniel', 'en-GB'), V('Eddy (英語（イギリス）)', 'en-GB'), V('Eddy (英語（アメリカ合衆国）)', 'en-US'),
  V('Flo (英語（イギリス）)', 'en-GB'), V('Fred', 'en-US'), V('Samantha', 'en-US'), V('Google US English', 'en-US', { localService: false }),
];

test('Mac Chrome・英語の既定なし・先頭が Albert → Samantha を明示指定', () => {
  assert.equal(pickVoiceFrom(macOwner).name, 'Samantha');
});

test('Samantha が無ければ Daniel（en-GB）', () => {
  assert.equal(pickVoiceFrom(macOwner.filter((v) => v.name !== 'Samantha')).name, 'Daniel');
});

test('優先リストが無くても、おもしろ音声・Eloquence 系は選ばない（端末内の声を先に）', () => {
  const list = [V('Albert', 'en-US'), V('Eddy (英語（アメリカ合衆国）)', 'en-US'), V('Google US English', 'en-US', { localService: false }), V('Mystery', 'en-US', { localService: false }), V('Local One', 'en-US')];
  const noPref = list.filter((v) => v.name !== 'Google US English');
  assert.equal(pickVoiceFrom(noPref).name, 'Local One');
});

test('既定の英語音声があれば今までどおりそれだけ', () => {
  const list = [V('Albert', 'en-US'), V('Aaron', 'en-US', { default: true }), V('Samantha', 'en-US')];
  assert.equal(pickVoiceFrom(list).name, 'Aaron');
});

test('ブラウザ任せの声がふつうの声なら未指定のまま（日本語 Windows の Chrome 等は挙動を変えない）', () => {
  const win = [V('Microsoft Haruka - Japanese (Japan)', 'ja-JP', { default: true }), V('Microsoft David - English (United States)', 'en-US'), V('Google US English', 'en-US', { localService: false })];
  assert.equal(pickVoiceFrom(win), null);
});

test('Chrome 系以外（Safari・iPhone）は英語の既定が無くても未指定のまま', () => {
  assert.equal(pickVoiceFrom(macOwner, { chromium: false }), null);
});

test('声が0件・英語の声なしは未指定（待たない）', () => {
  assert.equal(pickVoiceFrom([]), null);
  assert.equal(pickVoiceFrom([V('Kyoko', 'ja-JP', { default: true })]), null);
});
