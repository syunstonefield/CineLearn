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
const troubles = []; // 同期の不調（cl:sync-trouble）は失効とは別に記録する（2026-11-13）
globalThis.window = { dispatchEvent: (e) => void (e.type === 'cl:sync-trouble' ? troubles.push(e.detail) : events.push(e.type)), localStorage: globalThis.localStorage };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
let fetchLog = [];
let fetchImpl = async () => new Response('{}', { status: 200 });
globalThis.fetch = (...a) => { fetchLog.push(a[0]); return fetchImpl(...a); };

const { ensureFreshSession, ensureSessionForSync, SESSION_EXPIRED_EVENT, getSession, sessionRetry, sbFetch, lastRefreshFailure, getSyncTrouble } = await import('../lib/supabase.js');
sessionRetry.delayMs = 20; // 拡張の書き戻しを待つ時間（本番 1.5 秒）を短く

const now = () => Math.floor(Date.now() / 1000);
const session = (over = {}) => ({ access_token: 'old', refresh_token: 'r1', expires_at: now() + 30, user: { id: 'u1' }, ...over });
const reset = () => { store.clear(); events.length = 0; troubles.length = 0; fetchLog = []; };

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
  assert.equal(lastRefreshFailure(), 'rejected'); // 本当の期限切れ＝下からのシート
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

test('更新に失敗した直後は古いままでも、少し待つ間に拡張が書き戻せばそれを採る（セッションは消さない）', async () => {
  reset();
  store.set('cl_sb_session', JSON.stringify(session()));
  fetchImpl = async () => new Response(JSON.stringify({ msg: 'Invalid Refresh Token: Already Used' }), { status: 400 });
  setTimeout(() => store.set('cl_sb_session', JSON.stringify(session({ access_token: 'ext2', refresh_token: 'r7', expires_at: now() + 3000 }))), 5);
  assert.equal(await ensureFreshSession(), true);
  assert.equal(getSession().access_token, 'ext2');
  assert.deepEqual(events, []);
});

test('オフライン（fetch 失敗）・5xx・429 は失効ではない: false を返すが知らせず、セッションも残す', async () => {
  reset();
  store.set('cl_sb_session', JSON.stringify(session()));
  fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await ensureFreshSession(), false);
  assert.deepEqual(events, []);
  assert.equal(lastRefreshFailure(), 'offline'); // 起動時はこれを見て期限切れにしない（AppProvider）
  assert.equal(getSyncTrouble(), 'offline'); // 小さな札
  assert.equal(getSession().access_token, 'old');
  for (const status of [500, 503, 429]) {
    reset();
    store.set('cl_sb_session', JSON.stringify(session()));
    fetchImpl = async () => new Response('oops', { status });
    assert.equal(await ensureFreshSession(), false);
    assert.deepEqual(events, [], String(status));
    assert.equal(lastRefreshFailure(), 'temporary', String(status));
    assert.equal(getSyncTrouble(), 'temporary', String(status));
  }
  // 通信が戻って更新が通れば、そのまま続く（札も消える）
  fetchImpl = async () => new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_at: now() + 3600, user: { id: 'u1' } }), { status: 200 });
  assert.equal(await ensureFreshSession(), true);
  assert.equal(lastRefreshFailure(), null);
  assert.equal(getSyncTrouble(), null);
});

test('REST の 401: 更新を1回試して同じ要求をやり直す。更新後も 401 なら失効、更新が通信エラーなら失効にしない', async () => {
  // 期限は先だがサーバが 401（トークンが無効化された想定）→ 更新成功 → やり直しが 200
  reset();
  store.set('cl_sb_session', JSON.stringify(session({ expires_at: now() + 3600 })));
  const calls = [];
  fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_at: now() + 3600, user: { id: 'u1' } }), { status: 200 });
    return calls.filter((u) => u.includes('/rest/')).length === 1 ? new Response('{"msg":"JWT expired"}', { status: 401 }) : new Response('[{"ok":1}]', { status: 200 });
  };
  assert.deepEqual(await sbFetch('/rest/v1/user_state?select=key'), [{ ok: 1 }]);
  assert.deepEqual(events, []);
  assert.equal(calls.filter((u) => u.includes('/auth/v1/token')).length, 1);
  // 更新後も 401 → 失効
  reset();
  store.set('cl_sb_session', JSON.stringify(session({ expires_at: now() + 3600 })));
  fetchImpl = async (url) => (String(url).includes('/auth/v1/token') ? new Response(JSON.stringify({ access_token: 'new2', refresh_token: 'r3', expires_at: now() + 3600, user: { id: 'u1' } }), { status: 200 }) : new Response('{}', { status: 401 }));
  assert.deepEqual(await sbFetch('/rest/v1/user_state?select=key'), {}); // やり直し後の 401 の本文がそのまま返る
  assert.deepEqual(events, [SESSION_EXPIRED_EVENT]);
  // 更新が通信エラー → 失効にしない（帯なし）
  reset();
  store.set('cl_sb_session', JSON.stringify(session({ expires_at: now() + 3600 })));
  fetchImpl = async (url) => { if (String(url).includes('/auth/v1/token')) throw new TypeError('Failed to fetch'); return new Response('{}', { status: 401 }); };
  await sbFetch('/rest/v1/user_state?select=key');
  assert.deepEqual(events, []);
});
