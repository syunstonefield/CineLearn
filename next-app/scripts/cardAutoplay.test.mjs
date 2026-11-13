// カードの音声の自動再生の値（lib/cardAutoplay.js・2026-11-13）
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCardAutoplayOn, cardAutoplayPatch, cardAutoplayKey, CARD_AUTOPLAY_SETTING } from '../lib/cardAutoplay.js';

test('初期はオフ（設定が無い・古い端末・true 以外）', () => {
  assert.equal(isCardAutoplayOn(undefined), false);
  assert.equal(isCardAutoplayOn({}), false);
  assert.equal(isCardAutoplayOn({ cardAutoplay: 'true' }), false);
  assert.equal(isCardAutoplayOn({ cardAutoplay: true }), true);
});

test('書く差分は1つのキーだけ', () => {
  assert.equal(CARD_AUTOPLAY_SETTING, 'cardAutoplay');
  assert.deepEqual(cardAutoplayPatch(1), { cardAutoplay: true });
  assert.deepEqual(cardAutoplayPatch(false), { cardAutoplay: false });
});

test('同じカードの印は大文字小文字をそろえる・枚目が違えば別', () => {
  assert.equal(cardAutoplayKey(0, 'Harbor'), cardAutoplayKey(0, 'harbor'));
  assert.notEqual(cardAutoplayKey(0, 'harbor'), cardAutoplayKey(1, 'harbor'));
});
