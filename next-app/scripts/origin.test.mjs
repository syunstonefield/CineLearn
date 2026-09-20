// lib/server/origin.js（Origin ゲート・A7）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, extensionIdAllowlist, extensionIdEnforced } from '../lib/server/origin.js';

const req = (h = {}) => ({ headers: new Headers(h) });
const EXT_ID = 'jdhgbdpaeoihopelnnganoojpnplkiie';

test('空 Origin/Referer は拒否', () => {
  assert.equal(allowedOrigin(req({}), {}), false);
});

test('本番ホスト・自ホスト・localhost は許可、他ホストは拒否', () => {
  assert.equal(allowedOrigin(req({ origin: 'https://cinelearn-next.vercel.app' }), {}), true);
  assert.equal(allowedOrigin(req({ origin: 'https://cine-learn.vercel.app' }), {}), true);
  assert.equal(allowedOrigin(req({ referer: 'https://cinelearn-next.vercel.app/app' }), {}), true);
  assert.equal(allowedOrigin(req({ origin: 'https://preview-123.vercel.app', host: 'preview-123.vercel.app' }), {}), true);
  assert.equal(allowedOrigin(req({ origin: 'http://localhost:3000' }), {}), true);
  assert.equal(allowedOrigin(req({ origin: 'http://127.0.0.1:3000' }), {}), true);
  assert.equal(allowedOrigin(req({ origin: 'https://evil.example.com' }), {}), false);
  assert.equal(allowedOrigin(req({ origin: 'https://cinelearn-next.vercel.app.evil.com' }), {}), false);
  assert.equal(allowedOrigin(req({ origin: 'not a url' }), {}), false);
});

test('拡張: 登録 ID は許可・未登録は warn-only 既定で許可（warn が出る）', () => {
  const env = { CL_EXTENSION_IDS: `${EXT_ID}, badid` };
  assert.deepEqual([...extensionIdAllowlist(env)], [EXT_ID]); // 形式外は捨てる
  assert.equal(extensionIdEnforced(env), false);
  assert.equal(allowedOrigin(req({ origin: `chrome-extension://${EXT_ID}` }), env), true);
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a);
  try {
    assert.equal(allowedOrigin(req({ origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }), env), true);
  } finally {
    console.warn = orig;
  }
  assert.equal(warned.length, 1);
  assert.equal(warned[0][0], '[CL:ORIGIN] unknown ext id');
  assert.equal(warned[0][1], 'abcdefghijklmnopabcdefghijklmnop');
});

test('拡張: CL_EXTENSION_ID_ENFORCE=true では登録 ID のみ許可', () => {
  const env = { CL_EXTENSION_IDS: EXT_ID, CL_EXTENSION_ID_ENFORCE: 'true' };
  assert.equal(allowedOrigin(req({ origin: `chrome-extension://${EXT_ID}` }), env), true);
  assert.equal(allowedOrigin(req({ origin: `chrome-extension://${EXT_ID}/popup.html` }), env), true); // Referer 形
  assert.equal(allowedOrigin(req({ origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }), env), false);
  assert.equal(allowedOrigin(req({ origin: 'chrome-extension://' }), env), false);
});

test('拡張: 既定 ID は直書きされていない（env 無しの ENFORCE では何も通らない）', () => {
  const env = { CL_EXTENSION_ID_ENFORCE: 'true' };
  assert.equal(allowedOrigin(req({ origin: `chrome-extension://${EXT_ID}` }), env), false);
});
