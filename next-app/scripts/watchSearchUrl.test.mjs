// 入場で開く先（lib/prep.js の watchSearchUrl）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchSearchUrl } from '../lib/prep.js';

test('Disney+ は検索語を渡せないのでトップを開く（2026-11-12）', () => {
  assert.equal(watchSearchUrl('Modern Family', 'Disney+'), 'https://www.disneyplus.com/');
});

test('Netflix・Prime Video（日本）は作品名で検索ページ', () => {
  assert.equal(watchSearchUrl('Suits', 'Netflix'), 'https://www.netflix.com/search?q=Suits');
  assert.equal(watchSearchUrl('Mad Men', 'Amazon Prime'), 'https://www.amazon.co.jp/s?k=Mad%20Men&i=instant-video');
  assert.equal(watchSearchUrl('Suits', ''), 'https://www.netflix.com/search?q=Suits');
});
