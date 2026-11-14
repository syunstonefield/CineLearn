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

// ⑦ 2026-11-14: Google US English があれば、それが Samantha より先（きれいな声を最優先）
const macNoGoogle = macOwner.filter((v) => v.name !== 'Google US English');

test('Mac Chrome・Google US English あり → Google US English', () => {
  assert.equal(pickVoiceFrom(macOwner).name, 'Google US English');
});

test('Mac Chrome・英語の既定なし・先頭が Albert・Google なし → Samantha を明示指定', () => {
  assert.equal(pickVoiceFrom(macNoGoogle).name, 'Samantha');
});

test('Samantha も無ければ Daniel（en-GB）', () => {
  assert.equal(pickVoiceFrom(macNoGoogle.filter((v) => v.name !== 'Samantha')).name, 'Daniel');
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

const win = [V('Microsoft Haruka - Japanese (Japan)', 'ja-JP', { default: true }), V('Microsoft David - English (United States)', 'en-US'), V('Google US English', 'en-US', { localService: false })];

test('Windows の Chrome: Google US English を David より先に', () => {
  assert.equal(pickVoiceFrom(win).name, 'Google US English');
});

test('きれいな声が無く、ブラウザ任せの声がふつうの声なら未指定のまま', () => {
  assert.equal(pickVoiceFrom(win.filter((v) => v.name !== 'Google US English')), null);
});

test('Edge: Online (Natural) の Ava を最優先（既定の声や Google より先）', () => {
  const edge = [
    V('Microsoft David - English (United States)', 'en-US', { default: true }),
    V('Microsoft Guy Online (Natural) - English (United States)', 'en-US', { localService: false }),
    V('Microsoft AvaMultilingual Online (Natural) - English (United States)', 'en-US', { localService: false }),
    V('Microsoft Ava Online (Natural) - English (United States)', 'en-US', { localService: false }),
    V('Microsoft Libby Online (Natural) - English (United Kingdom)', 'en-GB', { localService: false }),
    V('Google US English', 'en-US', { localService: false }),
  ];
  assert.equal(pickVoiceFrom(edge).name, 'Microsoft Ava Online (Natural) - English (United States)');
});

test('ダウンロードした Premium の声は Google US English より先', () => {
  const list = [...macOwner, V('Zoe (Premium)', 'en-US')];
  assert.equal(pickVoiceFrom(list).name, 'Zoe (Premium)');
  const uri = [...macOwner, V('Ava', 'en-US', { voiceURI: 'com.apple.voice.enhanced.en-US.Ava' })];
  assert.equal(pickVoiceFrom(uri).name, 'Ava');
});

test('Android の Chrome（きれいな声の候補なし・既定の英語あり）は今までどおり既定', () => {
  const android = [V('English United States', 'en-US', { default: true }), V('English United Kingdom', 'en-GB')];
  assert.equal(pickVoiceFrom(android).name, 'English United States');
});

test('Chrome 系以外（Safari・iPhone）は英語の既定が無くても未指定のまま', () => {
  assert.equal(pickVoiceFrom(macOwner, { chromium: false }), null);
});

test('声が0件・英語の声なしは未指定（待たない）', () => {
  assert.equal(pickVoiceFrom([]), null);
  assert.equal(pickVoiceFrom([V('Kyoko', 'ja-JP', { default: true })]), null);
});

test('Safari・iPhone: Premium／Enhanced の声が入っていればそれを選ぶ', () => {
  const ios = [V('Samantha', 'en-US', { default: true }), V('Ava', 'en-US', { voiceURI: 'com.apple.voice.premium.en-US.Ava' }), V('Daniel', 'en-GB')];
  assert.equal(pickVoiceFrom(ios, { chromium: false }).name, 'Ava');
});

test('Safari・iPhone: Premium が無ければ今までどおり（既定の英語・無ければ未指定）', () => {
  assert.equal(pickVoiceFrom([V('Samantha', 'en-US', { default: true })], { chromium: false }).name, 'Samantha');
  assert.equal(pickVoiceFrom([V('Kyoko', 'ja-JP', { default: true }), V('Samantha', 'en-US')], { chromium: false }), null);
});

test('Safari では Google・Natural の名前があっても選ばない', () => {
  const list = [V('Google US English', 'en-US', { localService: false }), V('Samantha', 'en-US')];
  assert.equal(pickVoiceFrom(list, { chromium: false }), null);
});
