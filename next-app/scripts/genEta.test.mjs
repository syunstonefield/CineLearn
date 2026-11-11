// 待ち画面の目安の文（2026-11-12 実測で見直し）: ドラマ 30〜40秒→45秒を過ぎたら1分・映画 1分→70秒を過ぎたら1分半。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaText, ETA_LONG_TV_SEC, ETA_LONG_MOVIE_SEC } from '../lib/genEta.js';

test('ドラマ: 最初は30〜40秒・長くかかったら1分', () => {
  assert.match(etaText(false, 6), /30〜40秒ほど/);
  assert.match(etaText(false, ETA_LONG_TV_SEC - 1), /30〜40秒ほど/);
  assert.match(etaText(false, ETA_LONG_TV_SEC), /1分ほど/);
});

test('映画: 最初は1分・長くかかったら1分半', () => {
  assert.match(etaText(true, 6), /映画の単語リストは、1分ほど/);
  assert.match(etaText(true, ETA_LONG_MOVIE_SEC - 1), /1分ほど/);
  assert.match(etaText(true, ETA_LONG_MOVIE_SEC), /1分半ほど/);
  assert.doesNotMatch(etaText(true, 6), /1〜2分/);
});
