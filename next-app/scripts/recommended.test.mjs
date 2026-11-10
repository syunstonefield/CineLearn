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

test('おすすめ: 理由の1行に効果の言い切り・最上級を書かない（法務 2026-11-10）', async () => {
  const { RECOMMENDED } = await import('../lib/recommended.js');
  for (const d of RECOMMENDED) {
    assert.ok(d.reason, d.title);
    assert.doesNotMatch(d.reason, /最適|定番中の定番|自然に身につく|自然に学べる|世界的高評価|継続しやすい|続けられる/, d.title);
  }
});
