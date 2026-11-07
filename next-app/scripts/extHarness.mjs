// 拡張の実コード（background.js 全体＋content.js の関数）を偽の chrome.storage / fetch で動かす共用部品（2026-11-05〜）。
//   通信は外へ出ない。extAccountSwitch.test.mjs・extSessionSync.test.mjs から使う。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const content = readFileSync(new URL('../../extension/content.js', import.meta.url), 'utf8');
const background = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');

// content.js から関数を1つ抜き出す（文字列・コメントの中の括弧は数えない）。
function extract(name) {
  const m = content.match(new RegExp(`^function ${name}\\(`, 'm'));
  assert.ok(m, name);
  const open = content.indexOf('{', content.indexOf(')', m.index));
  let depth = 0;
  let quote = null;
  for (let j = open; j < content.length; j++) {
    const c = content[j];
    const n = content[j + 1];
    if (quote) {
      if (c === '\\') j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') j = content.indexOf('\n', j);
    else if (c === '/' && n === '*') j = content.indexOf('*/', j) + 1;
    else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return content.slice(m.index, j + 1);
  }
  throw new Error(name);
}
const CONTENT_FUNCS = ['refreshSavedWords', 'rebuildMarkSet', 'rebuildOtherSet', 'loadKnownWords', 'recordReunion', 'saveWord'].map(extract).join('\n');

export const sess = (u) => ({ access_token: `tok-${u}`, refresh_token: `r-${u}`, expires_at: Math.floor(Date.now() / 1000) + 3000, user: { id: u } });
export const word = (o) => ({ word: 'leverage', sentence: '', phonetic: '', pos: '', definition: '', ja: '', savedAt: '2026-11-05', tsSec: 500, source: 'x', ...o });
const silent = { log() {}, debug() {}, warn() {}, error() {} };

// 拡張ひとつ分（ストレージ・background・content を1組）。
// preset: 偽の Supabase の設定（refresh など）。background.js は読み込んだ直後に同期を始めるので、起動前に入れる。
export async function world(initial = {}, preset = {}) {
  const store = clone(initial);
  const changed = [];
  const received = [];
  const faults = { set: null, remove: null };
  const local = {
    get(keys, cb) {
      const out = {};
      if (keys === null) Object.assign(out, clone(store));
      else {
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        for (const k of list) if (k in store) out[k] = clone(store[k]);
      }
      if (cb) setTimeout(() => cb(out), 0);
      return Promise.resolve(out);
    },
    set(o, cb) {
      if (faults.set?.(o)) return Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
      const ch = {};
      for (const k in o) {
        ch[k] = { newValue: clone(o[k]) };
        store[k] = clone(o[k]);
      }
      changed.forEach((f) => f(ch, 'local'));
      if (cb) setTimeout(cb, 0);
      return Promise.resolve();
    },
    remove(k, cb) {
      if (faults.remove?.(k)) return Promise.reject(new Error('remove failed'));
      const ch = {};
      for (const x of Array.isArray(k) ? k : [k]) {
        delete store[x];
        ch[x] = {};
      }
      changed.forEach((f) => f(ch, 'local'));
      if (cb) setTimeout(cb, 0);
      return Promise.resolve();
    },
  };
  const posts = [];
  const gets = [];
  // 偽の Supabase。GET は PostgREST と同じく1回の応答を maxRows 行で黙って打ち切る（order=word.asc・offset 対応）。
  const cloud = { my_words: [], srs_data: [], maxRows: 1000, failGet: null, failPost: null, refresh: null };
  Object.assign(cloud, preset);
  const fakeFetch = async (url, o = {}) => {
    const u = new URL(String(url));
    const as = /tok-([A-Za-z0-9]+)/.exec(o.headers?.Authorization || '')?.[1] || null;
    if (u.pathname === '/auth/v1/token') return cloud.refresh ? cloud.refresh(JSON.parse(o.body)) : new Response('{}', { status: 400 });
    const table = u.pathname.split('/rest/v1/')[1];
    if ((o.method || 'GET') === 'POST') {
      const body = JSON.parse(o.body);
      posts.push({ as, table: table + u.search, body });
      const rejected = cloud.failPost?.(table, body); // 列が無い DB の応答などを返させる（{ status, json }）
      if (rejected) return new Response(JSON.stringify(rejected.json), { status: rejected.status });
      return new Response('', { status: 201 });
    }
    gets.push({ table, search: u.search });
    if (cloud.failGet?.(table, u.searchParams)) return new Response('{"message":"boom"}', { status: 500 });
    let rows = (cloud[table] || []).slice();
    if (u.searchParams.get('order') === 'word.asc') rows.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
    const offset = Number(u.searchParams.get('offset') || 0);
    const limit = Math.min(Number(u.searchParams.get('limit') || Infinity), cloud.maxRows);
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const mkChrome = () => ({
    storage: { local, onChanged: { addListener: (f) => changed.push(f) } },
    action: { onClicked: { addListener() {} } },
    tabs: { create() {} },
    runtime: {
      id: 'x',
      lastError: undefined,
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener: (f) => received.push(f) },
      sendMessage(msg, cb) {
        let done;
        const p = new Promise((r) => (done = r));
        for (const f of received) f(msg, {}, (v) => { done(v); if (cb) cb(v); });
        return p;
      },
    },
  });
  const bgCtx = vm.createContext({ chrome: mkChrome(), console: silent, fetch: fakeFetch, setTimeout, clearTimeout, Response, URL, AbortController });
  vm.runInContext(background, bgCtx);
  const ct = vm.createContext({ chrome: mkChrome(), console: silent, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)), clearTimeout, isFinite });
  vm.runInContext(
    `const CL_WORDS_KEY_BASE='cl_my_words', CL_KNOWN_KEY='cl_known_words', CL_KNOWN_TTL_MS=1800000, CL_REUNIONS_KEY='cl_reunions', CL_REUNIONS_MAX=500;
     var clCloudWords=[], clOtherWords=new Map(), clMarkCtx=null, clReunionSeen=new Set(), savedWordsAll=[], clMarkTitle='', clMarkSet=new Set(), clSavedMeaning=new Map(), clSavedPhrases=[], clAutoMarkSet=new Set(), reunionFlushTimer=null, _saveChain=Promise.resolve();
     const normMarkTitle=(t)=>String(t||'').trim().toLowerCase(); const normPhraseText=(s)=>String(s||'').toLowerCase();
     const refreshMarkers=()=>{}; const getActiveVideo=()=>({currentTime:100});
     ${CONTENT_FUNCS}
     var api={saveWord,refreshSavedWords,loadKnownWords,recordReunion,setTitle:(t)=>{clMarkTitle=t;rebuildMarkSet();},setCtx:(c)=>{clMarkCtx=c;},view:()=>JSON.parse(JSON.stringify({mark:[...clMarkSet],meaning:[...clSavedMeaning.keys()],other:[...clOtherWords.keys()],cloud:clCloudWords.map((c)=>c.w)}))};`,
    ct
  );
  const api = vm.runInContext('api', ct);
  const view = api.view;
  api.view = () => clone(view()); // vm の配列を assert.deepEqual で比べられる形に
  // content.js の storage 監視（保存語の更新と、ログイン/ログアウトでの取り直し）を同じ形で張る
  changed.push((ch) => {
    if (Object.keys(ch).some((k) => k.startsWith('cl_my_words'))) api.refreshSavedWords();
    if (ch.cl_sb_session) api.loadKnownWords(true);
  });
  await sleep(10);
  const w = {
    store,
    posts,
    faults,
    cloud,
    gets,
    runBg: (expr) => vm.runInContext(expr, bgCtx),
    api,
    settle: () => sleep(40),
    sendToBackground: (msg) => mkChrome().runtime.sendMessage(msg),
    async save(e) {
      api.saveWord(e);
      await sleep(40);
    },
    async login(u) {
      await local.set({ cl_sb_session: sess(u) });
      await sleep(40);
    },
    async logout() {
      await local.remove('cl_sb_session');
      await sleep(30);
    },
    async switchTo(u) {
      if (store.cl_sb_session) await w.logout();
      await w.login(u);
    },
  };
  return w;
}

