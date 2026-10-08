// lib/server/plan.js（isPro の土台）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMode, planFromRows, resolvePlan } from '../lib/server/plan.js';

const req = (h = {}) => ({ headers: new Headers(h) });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('CL_PLAN_MODE 未設定・不明値はベータ、release だけ正式版', () => {
  assert.equal(planMode({}), 'beta');
  assert.equal(planMode({ CL_PLAN_MODE: 'beta' }), 'beta');
  assert.equal(planMode({ CL_PLAN_MODE: 'Release' }), 'beta');
  assert.equal(planMode({ CL_PLAN_MODE: 'release' }), 'release');
});

test('ベータ中は全員 isPro:true で、Auth も DB も叩かない', async () => {
  let called = 0;
  const r = await resolvePlan(req({}), { env: {}, fetchImpl: async () => (called++, json({})) });
  assert.deepEqual(r, { ok: true, beta: true, isPro: true, plan: null });
  assert.equal(called, 0);
});

test('profiles の行のどれかが plus なら plus', () => {
  assert.equal(planFromRows([]), 'free');
  assert.equal(planFromRows(null), 'free');
  assert.equal(planFromRows([{ plan: 'free' }, { plan: 'plus' }]), 'plus');
  assert.equal(planFromRows([{ plan: 'PLUS' }]), 'free');
});

test('正式版: 未ログインは free（ok:true）', async () => {
  const r = await resolvePlan(req({}), { env: { CL_PLAN_MODE: 'release' }, serviceKey: 'svc' });
  assert.deepEqual(r, { ok: true, beta: false, isPro: false, plan: 'free' });
});

test('正式版: ログイン＋plus の行があれば isPro:true', async () => {
  const fetchImpl = async (url) =>
    String(url).includes('/auth/v1/user') ? json({ id: 'u-plus' }) : json([{ plan: 'free' }, { plan: 'plus' }]);
  const r = await resolvePlan(req({ authorization: 'Bearer tok-plus' }), {
    env: { CL_PLAN_MODE: 'release' },
    fetchImpl,
    serviceKey: 'svc',
  });
  assert.deepEqual(r, { ok: true, beta: false, isPro: true, plan: 'plus' });
});

test('正式版: DB 不調は free 側に倒し ok:false（クライアントは前回値を保つ）', async () => {
  const fetchImpl = async (url) => (String(url).includes('/auth/v1/user') ? json({ id: 'u-err' }) : json({}, 500));
  const r = await resolvePlan(req({ authorization: 'Bearer tok-err' }), {
    env: { CL_PLAN_MODE: 'release' },
    fetchImpl,
    serviceKey: 'svc',
  });
  assert.deepEqual(r, { ok: false, beta: false, isPro: false, plan: 'free' });
});
