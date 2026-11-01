import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendations } from '../lib/recommended.js';

test('おすすめ: サービス未設定（空）でも6件出る＝設定画面へ飛ばさない前提（2026-11-01）', () => {
  assert.equal(getRecommendations('B1', []).length, 6);
  assert.equal(getRecommendations('B1', undefined).length, 6);
});

test('おすすめ: サービスを選んでいればその中だけ', () => {
  const list = getRecommendations('C1', ['Amazon Prime']);
  assert.ok(list.length > 0);
  for (const d of list) assert.ok(d.services.includes('Amazon Prime'), d.title);
});
