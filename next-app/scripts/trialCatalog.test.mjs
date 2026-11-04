// 初回体験の作品の可用（lib/server/trialCatalog.js）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIAL_TMDB_IDS, enabledTrialIds, readTrialCatalog } from '../lib/server/trialCatalog.js';

test('体験の6作が固定で、enabled=true の行だけを元の並びで返す', () => {
  assert.deepEqual([...TRIAL_TMDB_IDS], [37680, 1668, 66732, 1726, 82596, 350]);
  const rows = [
    { tmdb_id: 1668, enabled: true },
    { tmdb_id: 37680, enabled: true },
    { tmdb_id: 1726, enabled: false }, // 権利者の要請で外した想定
    { tmdb_id: 66732, enabled: 'true' }, // 真偽値でない値は数えない
    { tmdb_id: 99999, enabled: true }, // 体験外の作品は返さない
  ];
  assert.deepEqual(enabledTrialIds(rows), [37680, 1668]);
  assert.deepEqual(enabledTrialIds(null), []);
  assert.deepEqual(enabledTrialIds([]), []);
});

test('catalog を読めない時は ok:false（画面は全部出す）・読めれば enabled だけ', async () => {
  const bad = await readTrialCatalog({ fetchImpl: async () => new Response('oops', { status: 500 }) });
  assert.deepEqual(bad, { ok: false, enabled: [] });
  let url = '';
  const good = await readTrialCatalog({
    fetchImpl: async (u) => {
      url = String(u);
      return new Response(JSON.stringify([{ tmdb_id: 350, enabled: true }, { tmdb_id: 82596, enabled: false }]));
    },
  });
  assert.deepEqual(good, { ok: true, enabled: [350] });
  assert.match(url, /catalog\?tmdb_id=in\.\(37680,1668,66732,1726,82596,350\)&select=tmdb_id,enabled$/);
});
