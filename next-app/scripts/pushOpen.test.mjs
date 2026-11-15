// 通知を押したら今日の復習（lib/pushOpen.js・2026-11-15）
import test from 'node:test';
import assert from 'node:assert/strict';

const ss = new Map();
globalThis.sessionStorage = { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: (k) => ss.delete(k) };
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
let href = 'https://x.test/app?open=review&n=evening#a';
globalThis.window = { get location() { return { href }; }, history: { state: null, replaceState: (_s, _t, u) => { href = 'https://x.test' + u; } } };
const { takePushOpenParam, takePendingPushOpen, hasPendingPushOpen, notePushOpen, pushOpenDecision } = await import('../lib/pushOpen.js');
const { isUsageEvent } = await import('../lib/usageEvents.js');

test('URL の印を読んで消し、1回だけ取り出せる・回数を数える', () => {
  assert.equal(takePushOpenParam(), true);
  assert.equal(href, 'https://x.test/app#a');
  assert.equal(hasPendingPushOpen(), true);
  assert.equal(takePendingPushOpen(), 'evening');
  assert.equal(takePendingPushOpen(), null);
  assert.equal(JSON.parse(ls.get('cl_usage_tally')).c.push_open_evening, 1);
  href = 'https://x.test/app?from=tiktok';
  assert.equal(takePushOpenParam(), false); // ほかの印はさわらない
  assert.equal(href, 'https://x.test/app?from=tiktok');
});

test('知らない種類は朝として扱う・名前は決まった2つだけ', () => {
  assert.equal(notePushOpen('x'), 'morning');
  assert.equal(takePendingPushOpen(), 'morning');
  assert.ok(isUsageEvent('push_open_morning') && isUsageEvent('push_open_evening'));
  assert.ok(!isUsageEvent('push_open_x'));
});

test('行き先の判断: ふつうの画面で語があれば復習・無ければホーム・起動中は待つ・途中や初めての流れでは動かさない', () => {
  assert.equal(pushOpenDecision({ screen: 'main', hasDue: true }), 'go');
  assert.equal(pushOpenDecision({ screen: 'main', hasDue: false }), 'home');
  assert.equal(pushOpenDecision({ screen: 'vocab', hasDue: true }), 'go');
  assert.equal(pushOpenDecision({ screen: 'main', busy: true, hasDue: true }), 'drop'); // カードの途中は動かさない（あとからも移らない）
  assert.equal(pushOpenDecision({ screen: 'profile-select', hasDue: true }), 'wait'); // 起動中
  assert.equal(pushOpenDecision({ screen: 'quiz', hasDue: true }), 'drop'); // クイズの途中
  assert.equal(pushOpenDecision({ screen: 'trial', hasDue: true }), 'drop');
  assert.equal(pushOpenDecision({ screen: 'intro', hasDue: false }), 'drop');
});
