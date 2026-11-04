// 2026-11-04 拡張の新規インストールで案内を開く。
//   ・extension/background.js: 開くのは install の時だけ（更新・Chrome 本体の更新では開かない）
//   ・manifest.json: tabs 権限を足さない（URL 指定の tabs.create に権限は要らない）
//   ・lib/extEntry.js: 印を URL から sessionStorage へ移す
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clearExtInstallEntry, isExtInstallEntry } from '../lib/extEntry.js';

function loadBackground() {
  const opened = [];
  let onInstalled = null;
  const listener = () => ({ addListener() {} });
  const chrome = {
    action: { onClicked: listener() },
    runtime: {
      onInstalled: { addListener: (fn) => (onInstalled = fn) },
      onMessage: listener(),
      onStartup: listener(),
    },
    storage: { onChanged: listener() },
    tabs: { create: (o) => opened.push(o) },
  };
  const src = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  vm.runInNewContext(src, { chrome, console, setTimeout, clearTimeout });
  return { opened, fire: (reason) => onInstalled({ reason }) };
}

test('新規インストールの時だけ、印つきの /app を開く', () => {
  const { opened, fire } = loadBackground();
  for (const reason of ['update', 'chrome_update', 'shared_module_update']) fire(reason);
  assert.equal(opened.length, 0);
  fire('install');
  assert.deepEqual(opened.map((o) => o.url), ['https://cinelearn-next.vercel.app/app?from=ext_install']);
});

test('manifest の権限は storage のまま（tabs を足さない）', () => {
  const m = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.permissions, ['storage']);
});

// ── lib/extEntry.js ──
function fakeBrowser(href) {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  const win = {
    location: { href },
    history: {
      state: { keep: 1 },
      replaceState(_s, _t, path) {
        win.location.href = new URL(path, win.location.href).href;
      },
    },
  };
  globalThis.window = win;
  return win;
}

beforeEach(() => {
  fakeBrowser('https://example.test/app');
  clearExtInstallEntry();
});

test('印つきで開くと true になり、URL から印だけ消える', () => {
  const win = fakeBrowser('https://example.test/app?x=1&from=ext_install#top');
  assert.equal(isExtInstallEntry(), true);
  assert.equal(win.location.href, 'https://example.test/app?x=1#top');
  assert.equal(isExtInstallEntry(), true, 'URL から消えた後もタブの間は覚えている');
});

test('印なし・別の値では false。閉じたら戻る', () => {
  fakeBrowser('https://example.test/app?from=other');
  assert.equal(isExtInstallEntry(), false);
  fakeBrowser('https://example.test/app?from=ext_install');
  assert.equal(isExtInstallEntry(), true);
  clearExtInstallEntry();
  assert.equal(isExtInstallEntry(), false);
});

test('sessionStorage が使えなくても、そのページの間は効く', () => {
  fakeBrowser('https://example.test/app?from=ext_install');
  globalThis.sessionStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(isExtInstallEntry(), true);
});
