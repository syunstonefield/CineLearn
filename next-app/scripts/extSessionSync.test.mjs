// 2026-11-07 拡張 v1.2.12 の同期まわり（受付経由オーナー決定）。
//   ① 1回の取得が 1000 行で切れる（救済の照合・再会の印）→ word 順のページ送り
//   ② アプリと拡張の refresh_token の取り合い → 拡張の更新をアプリへ戻す（bridge.js 双方向）・更新中に変わったら書かない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clone, sess, sleep, world } from './extHarness.mjs';

const words = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ word: `w${String(i + from).padStart(5, '0')}` }));

// ── ① ページ送り ──
test('救済: クラウドが 1000 語を超えても、2ページ目以降にある語を「無い」と誤認して送り直さない', async () => {
  const cloud = words(2500);
  const local = [cloud[1800], cloud[2400], { word: 'onlylocal' }].map((w) => ({ ...w, savedAt: '2026-10-20', ja: '端末の古い訳' }));
  const w = await world({ cl_last_user_id: 'A', cl_my_words: local });
  w.cloud.my_words = cloud;
  await w.login('A');
  await w.settle();
  assert.deepEqual(w.posts.filter((p) => p.table.startsWith('my_words')).map((p) => p.body[0].word), ['onlylocal']);
  assert.ok(w.store.cl_sync_recover_v1, '全ページ取れたので旗を立てる');
  assert.ok(w.gets.some((g) => g.table === 'my_words' && g.search.includes('offset=2000')), '3ページ目まで読んだ');
});

test('救済: サーバの上限が 1000 より小さくても取りこぼさない', async () => {
  const cloud = words(700);
  const w = await world({ cl_last_user_id: 'A', cl_my_words: [{ ...cloud[650], savedAt: '2026-10-20' }] });
  w.cloud.my_words = cloud;
  w.cloud.maxRows = 300;
  await w.login('A');
  await w.settle();
  assert.equal(w.posts.length, 0);
});

test('救済: 途中のページで失敗したら何も送らず、旗も立てない。次の契機でやり直す', async () => {
  const cloud = words(2500);
  const w = await world({ cl_last_user_id: 'A', cl_my_words: [{ ...cloud[2400], savedAt: '2026-10-20' }, { word: 'onlylocal', savedAt: '2026-10-20' }] });
  w.cloud.my_words = cloud;
  w.cloud.failGet = (table, q) => table === 'my_words' && q.get('offset') === '1000';
  await w.login('A');
  await w.settle();
  assert.equal(w.posts.length, 0);
  assert.equal(w.store.cl_sync_recover_v1, undefined);
  w.cloud.failGet = null;
  await w.login('A');
  await w.settle();
  assert.deepEqual(w.posts.map((p) => p.body[0].word), ['onlylocal']);
  assert.ok(w.store.cl_sync_recover_v1);
});

test('再会の印: 単語帳と覚えた語が 1000 を超えても全部取る。途中で失敗したら前回の控えのまま', async () => {
  const w = await world({ cl_sb_session: sess('A'), cl_last_user_id: 'A', cl_ledger_owner: 'A', cl_sync_recover_v1: 1 });
  w.cloud.my_words = words(1500);
  w.cloud.srs_data = words(1200, 5000).map((x) => ({ ...x, repetitions: 2, interval: 3, ease_factor: 2.5 }));
  const res = await w.sendToBackground({ type: 'CL_FETCH_KNOWN_WORDS' });
  assert.equal(res.found, true);
  assert.equal(res.words.length, 2700);
  assert.ok(w.gets.filter((g) => g.table === 'my_words').every((g) => !g.search.includes('in_wordbook')), '★の有無で絞らない（単語帳の既定が「入れない」でも拡張の保存語に印が付く）');
  w.cloud.failGet = (table, q) => q.get('offset') === '1000';
  const failed = await w.sendToBackground({ type: 'CL_FETCH_KNOWN_WORDS' });
  assert.equal(failed.found, false, '途中までの結果で印を作らない');
});

// ── ② 拡張の更新と、その間の変化 ──
const expiring = (u) => ({ ...sess(u), expires_at: Math.floor(Date.now() / 1000) + 60 }); // 10分を切っている
const refreshed = (u) => ({ access_token: `tok-${u}2`, refresh_token: `r-${u}2`, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: u } });

test('拡張の更新: 通常は新しいセッションを書く', async () => {
  const w = await world({ cl_sb_session: expiring('A'), cl_ledger_owner: 'A', cl_last_user_id: 'A', cl_sync_recover_v1: 1 }, { refresh: () => new Response(JSON.stringify(refreshed('A')), { status: 200 }) });
  const got = await w.runBg('getFreshSession()');
  assert.equal(got.refresh_token, 'r-A2');
  assert.equal(w.store.cl_sb_session.refresh_token, 'r-A2');
});

test('拡張の更新は期限の15分前から（アプリの10分前より先に更新してアプリへ戻す）', async () => {
  const inMin = (m) => ({ ...sess('A'), expires_at: Math.floor(Date.now() / 1000) + m * 60 });
  const w = await world({ cl_sb_session: inMin(20), cl_ledger_owner: 'A', cl_last_user_id: 'A', cl_sync_recover_v1: 1 }, { refresh: () => new Response(JSON.stringify(refreshed('A')), { status: 200 }) });
  assert.equal((await w.runBg('getFreshSession()')).refresh_token, 'r-A', '20分先ならまだ更新しない');
  w.store.cl_sb_session = inMin(12);
  assert.equal((await w.runBg('getFreshSession()')).refresh_token, 'r-A2', '12分先なら更新する（アプリはまだ更新しない時点）');
});

for (const [label, change, expect] of [
  ['アプリから新しいセッションが届いた', (w) => (w.store.cl_sb_session = { ...sess('A'), refresh_token: 'r-from-app' }), (s) => assert.equal(s.refresh_token, 'r-from-app')],
  ['別の人に切り替わった', (w) => (w.store.cl_sb_session = sess('B')), (s) => assert.equal(s.user.id, 'B')],
  ['ログアウトした', (w) => delete w.store.cl_sb_session, (s) => assert.equal(s, undefined)],
]) {
  test(`拡張の更新の途中で${label}ら、古いセッションの結果で上書きしない`, async () => {
    let release;
    const w = await world({ cl_sb_session: expiring('A'), cl_ledger_owner: 'A', cl_last_user_id: 'A', cl_sync_recover_v1: 1 }, { refresh: () => new Promise((r) => (release = () => r(new Response(JSON.stringify(refreshed('A')), { status: 200 })))) });
    const p = w.runBg('getFreshSession()');
    await sleep(10);
    change(w);
    release();
    assert.equal(await p, null);
    expect(w.store.cl_sb_session);
  });
}

test('拡張の更新が 400 でも、その間にアプリから新しいセッションが届いていたら消さない', async () => {
  let release;
  const w = await world({ cl_sb_session: expiring('A'), cl_ledger_owner: 'A', cl_last_user_id: 'A', cl_sync_recover_v1: 1 }, { refresh: () => new Promise((r) => (release = () => r(new Response('{"error":"invalid_grant","error_description":"Invalid Refresh Token: Already Used"}', { status: 400 })))) });
  const p = w.runBg('getFreshSession()');
  await sleep(10);
  w.store.cl_sb_session = { ...sess('A'), refresh_token: 'r-from-app' };
  release();
  await p;
  assert.equal(w.store.cl_sb_session.refresh_token, 'r-from-app');
});

// ── ② bridge.js（アプリの画面に入る側） ──
const bridgeSrc = readFileSync(new URL('../../extension/bridge.js', import.meta.url), 'utf8');
const UID_A = '00000000-0000-4000-8000-00000000000a';
const UID_B = '00000000-0000-4000-8000-00000000000b';
const S = (uid, tag, exp) => ({ access_token: `at-${tag}`, refresh_token: `rt-${tag}`, expires_at: exp, expires_in: 3600, token_type: 'bearer', user: { id: uid } });

function bridgeWorld({ app = null, ext = undefined } = {}) {
  const ls = new Map(app === null ? [] : [['cl_sb_session', typeof app === 'string' ? app : JSON.stringify(app)]]);
  const store = ext === undefined ? {} : { cl_sb_session: clone(ext) };
  const events = [];
  const onChanged = [];
  const timers = [];
  const ctx = {
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    window: { addEventListener() {}, dispatchEvent: (e) => events.push(e.type) },
    document: { addEventListener() {}, visibilityState: 'visible' },
    Event: class { constructor(type) { this.type = type; } },
    setInterval: (f) => timers.push(f),
    chrome: {
      storage: {
        local: {
          get: async (k) => (k in store ? { [k]: clone(store[k]) } : {}),
          set: async (o) => { for (const k in o) store[k] = clone(o[k]); onChanged.forEach((f) => f(Object.fromEntries(Object.keys(o).map((k) => [k, {}])), 'local')); },
          remove: async (k) => { delete store[k]; },
        },
        onChanged: { addListener: (f) => onChanged.push(f) },
      },
    },
  };
  vm.runInNewContext(bridgeSrc, ctx);
  return {
    app: () => (ls.has('cl_sb_session') ? JSON.parse(ls.get('cl_sb_session')) : null),
    ext: () => store.cl_sb_session,
    setApp: (v) => (v === null ? ls.delete('cl_sb_session') : ls.set('cl_sb_session', JSON.stringify(v))),
    setExt: async (v) => ctx.chrome.storage.local.set({ cl_sb_session: v }),
    tick: async () => { timers.forEach((f) => f()); await sleep(5); },
    events,
  };
}

test('bridge: 拡張が更新した新しいセッション（同じ人）をアプリへ戻し、cl-session-updated を出す', async () => {
  const b = bridgeWorld({ app: S(UID_A, 'old', 1000), ext: S(UID_A, 'new', 5000) });
  await sleep(5);
  assert.equal(b.app().refresh_token, 'rt-new');
  assert.deepEqual(b.events, ['cl-session-updated']);
  assert.equal(b.ext().refresh_token, 'rt-new', '拡張側は古い方で潰さない');
});

test('bridge: 読み込み時にアプリの古いセッションで拡張の新しいセッションを潰さない（今までの不具合）', async () => {
  const b = bridgeWorld({ app: S(UID_A, 'old', 1000), ext: S(UID_A, 'new', 5000) });
  await b.tick();
  await b.tick();
  assert.equal(b.ext().refresh_token, 'rt-new');
  assert.equal(b.app().refresh_token, 'rt-new');
});

test('bridge: アプリが更新した（新しい）時はアプリ→拡張', async () => {
  const b = bridgeWorld({ app: S(UID_A, 'app', 5000), ext: S(UID_A, 'ext', 1000) });
  await sleep(5);
  assert.equal(b.ext().refresh_token, 'rt-app');
  assert.deepEqual(b.events, []);
});

test('bridge: 別の人なら、拡張の方が新しくても書き戻さずアプリ→拡張（台帳の入れ替えへ）', async () => {
  const b = bridgeWorld({ app: S(UID_B, 'b', 1000), ext: S(UID_A, 'a', 9000) });
  await sleep(5);
  assert.equal(b.app().user.id, UID_B);
  assert.equal(b.ext().user.id, UID_B);
  assert.deepEqual(b.events, []);
});

test('bridge: アプリにセッションが無い時は書き戻さない。ログアウトした瞬間は拡張側も消す', async () => {
  const fresh = bridgeWorld({ app: null, ext: S(UID_A, 'a', 9000) });
  await sleep(5);
  assert.equal(fresh.app(), null, 'ログアウト後に拡張のセッションでログインし直させない');
  assert.equal(fresh.ext().refresh_token, 'rt-a', '読み込み時に元から無いだけなら消さない（今まで通り）');
  const b = bridgeWorld({ app: S(UID_A, 'a', 5000), ext: S(UID_A, 'a', 5000) });
  await sleep(5);
  b.setApp(null);
  await b.tick();
  assert.equal(b.ext(), undefined);
  await b.setExt(S(UID_A, 'late', 9000)); // ログアウト後に拡張の更新が遅れて届いても
  await sleep(5);
  assert.equal(b.app(), null);
});

test('bridge: 形の正しくない値は、どちら向きにも運ばない', async () => {
  const bad = bridgeWorld({ app: '{"access_token":"x"}', ext: S(UID_A, 'a', 9000) });
  await sleep(5);
  assert.equal(bad.ext().refresh_token, 'rt-a');
  const badExt = bridgeWorld({ app: S(UID_A, 'a', 1000), ext: { access_token: 'x', user: { id: UID_A }, expires_at: 9999 } });
  await sleep(5);
  assert.equal(badExt.app().refresh_token, 'rt-a');
  assert.equal(badExt.ext().refresh_token, 'rt-a');
});

test('bridge: 拡張が更新した時（chrome.storage の変化）にも照合する', async () => {
  const b = bridgeWorld({ app: S(UID_A, 'a', 1000), ext: S(UID_A, 'a', 1000) });
  await sleep(5);
  await b.setExt(S(UID_A, 'refreshed', 5000));
  await sleep(5);
  assert.equal(b.app().refresh_token, 'rt-refreshed');
});
