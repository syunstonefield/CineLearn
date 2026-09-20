// lib/ratelimit.js（A27）の単体テスト。Upstash は fetch をモックして pipeline の中身を検証する。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, checkRateLimitEntries, windowResetAtUtc } from '../lib/ratelimit.js';

const ENV = { UPSTASH_REDIS_REST_URL: 'https://upstash.test', UPSTASH_REDIS_REST_TOKEN: 'tok' };
const req = (ip = '203.0.113.7') => ({ headers: new Headers({ 'x-forwarded-for': `${ip}, 10.0.0.1` }) });

// 呼ばれた pipeline のコマンド配列を記録し、INCR には counts で応答する簡易モック。
function mockUpstash({ counts = {}, status = 200, body = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const cmds = JSON.parse(init.body);
    calls.push({ url, cmds });
    if (status !== 200) return new Response('oops', { status });
    if (body !== null) return new Response(JSON.stringify(body), { status: 200 });
    const out = cmds.map((c) => {
      if (c[0] === 'INCR') return { result: counts[c[1]] ?? 1 };
      if (c[0] === 'DECR') return { result: 0 };
      return { result: 1 }; // EXPIRE
    });
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { calls, fetchImpl };
}

const NOW = Date.UTC(2026, 8, 12, 3, 4, 5); // 2026-09-12T03:04:05Z
const idx = { m: Math.floor(NOW / 60000), h: Math.floor(NOW / 3600000), d: Math.floor(NOW / 86400000) };

test('未設定なら no-op（通信しない・release も no-op）', async () => {
  const { calls, fetchImpl } = mockUpstash();
  const r = await checkRateLimit(req(), 'claude', {}, { env: {}, fetchImpl });
  assert.equal(r.ok, true);
  await r.release();
  assert.equal(calls.length, 0);
});

test('pipeline はキー配列から導出され、添字 i*2 が INCR に対応する（IP 既定 30/300）', async () => {
  const { calls, fetchImpl } = mockUpstash();
  const r = await checkRateLimit(req(), 'claude', {}, { env: ENV, fetchImpl, now: () => NOW });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  const cmds = calls[0].cmds;
  assert.deepEqual(cmds, [
    ['INCR', `rl:claude:203.0.113.7:m:${idx.m}`],
    ['EXPIRE', `rl:claude:203.0.113.7:m:${idx.m}`, '60', 'NX'],
    ['INCR', `rl:claude:203.0.113.7:h:${idx.h}`],
    ['EXPIRE', `rl:claude:203.0.113.7:h:${idx.h}`, '3600', 'NX'],
  ]);
});

test('perDay と subject（user:<uid>）と extra キーが同じ pipeline に乗る。0 以下の窓は張らない', async () => {
  const { calls, fetchImpl } = mockUpstash();
  const r = await checkRateLimit(
    req(),
    'vocab-ip',
    { perMin: 0, perHour: 0, perDay: 60 },
    {
      env: ENV,
      fetchImpl,
      now: () => NOW,
      subject: 'user:abc',
      subjectLimits: { perHour: 15, perDay: 30 },
      extra: [{ keyBase: 'rl:example-manual:ep:v2:tmdb1:s1e1', window: 'day', limit: 60, scope: 'episode' }],
      failClosed: true,
    }
  );
  assert.equal(r.ok, true);
  const incrKeys = calls[0].cmds.filter((c) => c[0] === 'INCR').map((c) => c[1]);
  assert.deepEqual(incrKeys, [
    `rl:vocab-ip:203.0.113.7:d:${idx.d}`,
    `rl:vocab-ip:user:abc:h:${idx.h}`,
    `rl:vocab-ip:user:abc:d:${idx.d}`,
    `rl:example-manual:ep:v2:tmdb1:s1e1:d:${idx.d}`,
  ]);
  // EXPIRE の TTL は窓ごと
  const ttls = calls[0].cmds.filter((c) => c[0] === 'EXPIRE').map((c) => c[2]);
  assert.deepEqual(ttls, ['86400', '3600', '86400', '86400']);
});

test('上限超過は全キー DECR で戻し、window/scope/resetAtUtc を返す', async () => {
  const userDay = `rl:vocab-ip:user:abc:d:${idx.d}`;
  const { calls, fetchImpl } = mockUpstash({ counts: { [userDay]: 31 } });
  const r = await checkRateLimit(
    req(),
    'vocab-ip',
    { perMin: 0, perHour: 0, perDay: 60 },
    { env: ENV, fetchImpl, now: () => NOW, subject: 'user:abc', subjectLimits: { perHour: 15, perDay: 30 } }
  );
  assert.equal(r.ok, false);
  assert.equal(r.window, 'day');
  assert.equal(r.scope, 'user');
  assert.equal(r.limit, 30);
  assert.equal(r.resetAtUtc, windowResetAtUtc('day', NOW));
  assert.equal(r.resetAtUtc, '2026-09-13T00:00:00.000Z');
  assert.equal(calls.length, 2);
  const undo = calls[1].cmds;
  assert.deepEqual(undo.filter((c) => c[0] === 'DECR').map((c) => c[1]), [
    `rl:vocab-ip:203.0.113.7:d:${idx.d}`,
    `rl:vocab-ip:user:abc:h:${idx.h}`,
    userDay,
  ]);
  assert.ok(undo.every((c, i) => (i % 2 === 0 ? c[0] === 'DECR' : c[0] === 'EXPIRE' && c[3] === 'NX')));
  await r.release(); // ブロック時の release は no-op
  assert.equal(calls.length, 2);
});

test('release はワンショットで DECR し、TTL を過ぎたキーは戻さない', async () => {
  const { calls, fetchImpl } = mockUpstash();
  let t = NOW;
  const r = await checkRateLimit(req(), 'vocab-anon', { perMin: 2, perHour: 6, perDay: 8 }, { env: ENV, fetchImpl, now: () => t });
  assert.equal(r.ok, true);
  t = NOW + 90_000; // 90秒後＝分窓は TTL(60s) 満了・時/日は生きている
  await r.release();
  await r.release(); // 2回目は何もしない
  assert.equal(calls.length, 2);
  const decr = calls[1].cmds.filter((c) => c[0] === 'DECR').map((c) => c[1]);
  assert.deepEqual(decr, [`rl:vocab-anon:203.0.113.7:h:${idx.h}`, `rl:vocab-anon:203.0.113.7:d:${idx.d}`]);
});

test('既定は fail-open、failClosed は非200/例外で unavailable', async () => {
  const bad = mockUpstash({ status: 500 });
  assert.equal((await checkRateLimit(req(), 'claude', {}, { env: ENV, fetchImpl: bad.fetchImpl })).ok, true);
  const closed = await checkRateLimit(req(), 'vocab-anon', {}, { env: ENV, fetchImpl: bad.fetchImpl, failClosed: true });
  assert.equal(closed.ok, false);
  assert.equal(closed.unavailable, true);
  const thrower = async () => {
    throw new Error('network');
  };
  assert.equal((await checkRateLimit(req(), 'claude', {}, { env: ENV, fetchImpl: thrower })).ok, true);
  assert.equal((await checkRateLimit(req(), 'vocab-anon', {}, { env: ENV, fetchImpl: thrower, failClosed: true })).unavailable, true);
});

test('failClosed で INCR 後に応答が壊れていたら DECR を試みてから unavailable', async () => {
  const { calls, fetchImpl } = mockUpstash({ body: [{ result: 'garbage' }] });
  const r = await checkRateLimit(req(), 'vocab-anon', { perMin: 2, perHour: 0, perDay: 0 }, { env: ENV, fetchImpl, failClosed: true, now: () => NOW });
  assert.equal(r.ok, false);
  assert.equal(r.unavailable, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cmds[0][0], 'DECR');
});

test('checkRateLimitEntries: エントリ無しは ok、extra だけの張り方もできる', async () => {
  const { calls, fetchImpl } = mockUpstash();
  const none = await checkRateLimitEntries([], { env: ENV, fetchImpl });
  assert.equal(none.ok, true);
  assert.equal(calls.length, 0);
  const only = await checkRateLimit(req(), 'example', {}, {
    env: ENV,
    fetchImpl,
    now: () => NOW,
    ipLimitsOff: true,
    extra: [{ keyBase: 'rl:example:203.0.113.7:ep:v2:tmdb1:s1e1', window: 'day', limit: 100, scope: 'episode' }],
  });
  assert.equal(only.ok, true);
  assert.deepEqual(calls[0].cmds.filter((c) => c[0] === 'INCR').map((c) => c[1]), [`rl:example:203.0.113.7:ep:v2:tmdb1:s1e1:d:${idx.d}`]);
});
