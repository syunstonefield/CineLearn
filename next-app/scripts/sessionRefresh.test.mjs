// セッション更新（lib/supabase.js ensureFreshSession / ensureSessionForSync・2026-11-07 候補C）の単体テスト。
//   window / localStorage / fetch を偽物にして node で読む。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};
const events = [];
globalThis.window = { dispatchEvent: (e) => void events.push(e.type), localStorage: globalThis.localStorage };
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
let fetchLog = [];
let fetchImpl = async () => new Response('{}', { status: 200 });
globalThis.fetch = (...a) => { fetchLog.push(a[0]); return fetchImpl(...a); };

const { ensureFreshSession, ensureSessionForSync, SESSION_EXPIRED_EVENT, getSession } = await import('../lib/supabase.js');

const now = () => Math.floor(Date.now() / 1000);
const session = (over = {}) => ({ access_token: 'old', refresh_token: 'r1', expires_at: now() + 30, user: { id: 'u1' }, ...over });
const reset = () => { store.clear(); events.length = 0; fetchLog = []; };

test('期限が近い時に更新し、成功したら新しいセッションを保存する', async () => {
  reset();
  store.set('cl_sb_session', JSON.stringify(session()));
  fetchImpl = async () => new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_at: now() + 3600, user: { id: 'u1' } }), { status: 200 });
  assert.equal(await ensureFreshSession(), true);
  assert.equal(getSession().access_token, 'new');
  assert.deepEqual(events, []);
});

test('更新に失敗（使用済み refresh_token など）したら失効を知らせて false・セッションは残す', async () => {
  reset();
  store.set('cl_sb_session', JSON.stringify(session()));
  fetchImpl = async () => new Response(JSON.stringify({ error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' }), { status: 400 });
  assert.equal(await ensureFreshSession(), false);
  assert.deepEqual(events, [SESSION_EXPIRED_EVENT]);
  assert.equal(getSession().access_token, 'old');
});

test('更新に失敗しても、拡張（bridge 双方向）が新しいセッションを書き戻していればそれを採る（古い拡張でも壊れない）', async () => {
  reset();
  store.set('cl_sb_session', JSON.stringify(session()));
  fetchImpl = async () => {
    // 更新の最中に bridge が新しいセッションを書き戻した想定
    store.set('cl_sb_session', JSON.stringify(session({ access_token: 'ext', refresh_token: 'r9', expires_at: now() + 3000 })));
    return new Response(JSON.stringify({ msg: 'Invalid Refresh Token: Already Used' }), { status: 400 });
  };
  assert.equal(await ensureFreshSession(), true);
  assert.deepEqual(events, []);
  assert.equal(getSession().access_token, 'ext');
});

test('同時に何度呼んでも更新は1回だけ（refresh_token を二度使わない）', async () => {
  reset();
  store.set('cl_sb_session', JSON.stringify(session()));
  fetchImpl = async () => { await new Promise((r) => setTimeout(r, 20)); return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_at: now() + 3600, user: { id: 'u1' } }), { status: 200 }); };
  const r = await Promise.all([ensureFreshSession(), ensureFreshSession(), ensureSessionForSync()]);
  assert.deepEqual(r, [true, true, true]);
  assert.equal(fetchLog.length, 1);
});

test('送信前の判定: ログイン中は更新しない・未ログインは静かに false・期限切れは更新を試す', async () => {
  reset();
  store.set('cl_sb_session', JSON.stringify(session({ expires_at: now() + 3600 })));
  assert.equal(await ensureSessionForSync(), true);
  assert.equal(fetchLog.length, 0);
  reset();
  assert.equal(await ensureSessionForSync(), false);
  assert.deepEqual(events, []);
  reset();
  store.set('cl_sb_session', JSON.stringify(session({ expires_at: now() - 10 })));
  fetchImpl = async () => new Response('{}', { status: 400 });
  assert.equal(await ensureSessionForSync(), false);
  assert.deepEqual(events, [SESSION_EXPIRED_EVENT]);
});
