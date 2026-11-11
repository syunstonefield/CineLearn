// SRS のクラウド送信（lib/supabase.js pushSrsWords）のテスト・2026-11-12
//   ① 列が無いと弾かれた列は、ページを閉じるまでではなく 10分たったら送り直す（デプロイ→SQL の間に開いていたページ対策）
//   ネットワークは差し替え（本番へは送らない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = globalThis.window || { addEventListener() {}, dispatchEvent() {} };
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const UID = '00000000-0000-0000-0000-000000000000';
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
store.set('cl_sb_session', JSON.stringify({ access_token: 'fake', expires_at: Math.floor(now / 1000) + 365 * 86400, user: { id: UID } }));

const sent = [];
let missingCol = null; // この列を含む送信には PGRST204 を返す（列が無い DB の真似）
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('/rest/v1/srs_data') && init.method === 'POST') {
    const body = JSON.parse(init.body);
    sent.push(body);
    if (missingCol && body.some((r) => missingCol in r)) {
      return { status: 400, ok: false, json: async () => ({ code: 'PGRST204', message: `Could not find the '${missingCol}' column of 'srs_data' in the schema cache` }) };
    }
    return { status: 201, ok: true, json: async () => null };
  }
  return { status: 200, ok: true, json: async () => [] };
};
const { pushSrsWords, SRS_COLUMN_RETRY_MS } = await import('../lib/supabase.js');
const entry = (q) => ({ interval: 1, repetitions: 0, easeFactor: 2.5, dueDate: '2026-11-12', lastReview: '2026-11-11', lastQuality: q, updatedAt: '2026-11-11T01:00:00Z' });

test('列がある時は last_quality を送る', async () => {
  sent.length = 0;
  missingCol = null;
  await pushSrsWords({ alpha: entry(3) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].last_quality, 3);
});

test('列が無いと弾かれたら外して送り直し、10分たつまでは送らず、10分後にまた送る', async () => {
  sent.length = 0;
  missingCol = 'last_quality';
  await pushSrsWords({ beta: entry(0) });
  assert.equal(sent.length, 2); // 1回目は弾かれ、外して送り直す
  assert.equal('last_quality' in sent[1][0], false);

  now += 60 * 1000; // 1分後（まだ送らない）
  missingCol = null; // ここで列が足された
  await pushSrsWords({ gamma: entry(5) });
  assert.equal('last_quality' in sent.at(-1)[0], false);

  now += SRS_COLUMN_RETRY_MS; // 10分たった
  await pushSrsWords({ delta: entry(3) });
  assert.equal(sent.at(-1)[0].last_quality, 3); // また送る（列がある＝そのまま通る）
});

test.after(() => {
  Date.now = realNow;
});
