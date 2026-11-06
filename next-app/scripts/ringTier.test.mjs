// lib/rings.js の枠（ringTier / ringFractions）の単体テスト（2026-11-07・枠は下がらない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING_TIERS, ringTier, ringFractions } from '../lib/rings.js';

test('ringTier は出会った語数が収まる最小の段階（上限を超えたら最上段）', () => {
  assert.equal(ringTier(0), 100);
  assert.equal(ringTier(100), 100);
  assert.equal(ringTier(101), 250);
  assert.equal(ringTier(1000), 1000);
  assert.equal(ringTier(1001), 2000);
  assert.equal(ringTier(99999), RING_TIERS[RING_TIERS.length - 1]);
});

test('ringFractions は v.tier（台帳の最高値から決めた枠）を優先し、無ければ v.met から決める', () => {
  // 消去で met が 1,020→980 に減っても tier=2000 のまま＝覚えた・マスターの弧は変わらない
  const before = ringFractions({ met: 1020, learned: 300, mastered: 60, tier: 2000 });
  const after = ringFractions({ met: 980, learned: 300, mastered: 60, tier: 2000 });
  assert.equal(after.learned, before.learned);
  assert.equal(after.mastered, before.mastered);
  assert.ok(after.met < before.met);
  // tier が無い値は従来どおり met から（980→枠 1000）
  const legacy = ringFractions({ met: 980, learned: 300, mastered: 60 });
  assert.equal(legacy.learned, 0.3);
  // 引数の tier は from / glowFrom（tier を持たない途中の値）を今の枠で描くため
  const fromV = ringFractions({ met: 0, learned: 0, mastered: 0 }, 2000);
  assert.deepEqual(fromV, { met: 0, learned: 0, mastered: 0 });
  assert.equal(ringFractions({ met: 500, learned: 100, mastered: 0 }, 2000).learned, 0.05);
});
