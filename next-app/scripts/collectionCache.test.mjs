// cl_total_eps_*（TMDB のシーズン情報の端末キャッシュ）の期限（lib/collection.js・法務 2026-11-12）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFreshEpsCache, EPS_CACHE_TTL_MS } from '../lib/collection.js';

test('取得日の無い旧キャッシュは取り直す', () => {
  assert.equal(isFreshEpsCache({ total: 10 }), false);
  assert.equal(isFreshEpsCache(null), false);
});

test('90日以内は使い、それより古いものは取り直す（6か月より短い）', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  assert.equal(isFreshEpsCache({ at: now - 1000 }, now), true);
  assert.equal(isFreshEpsCache({ at: now - EPS_CACHE_TTL_MS - 1 }, now), false);
  assert.ok(EPS_CACHE_TTL_MS < 180 * 24 * 60 * 60 * 1000);
});
