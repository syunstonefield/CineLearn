// 入場で開くサービス・「配信：」の1行（lib/serviceEntry.js・2026-11-10）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extServicesFromProviders, entryTarget, sheetOrder, serviceLabel } from '../lib/serviceEntry.js';

const prov = (jp) => ({ results: { JP: jp } });

test('配信：拡張が対応する3つだけ・見放題/広告つき/無料の枠だけ・決まった順', () => {
  const data = prov({
    flatrate: [{ provider_id: 337 }, { provider_id: 15 }], // Disney+・Hulu（Hulu は載せない）
    ads: [{ provider_id: 1796 }], // Netflix 広告つき
    rent: [{ provider_id: 9 }], // レンタルは数えない
  });
  assert.deepEqual(extServicesFromProviders(data), ['Netflix', 'Disney+']);
  assert.deepEqual(extServicesFromProviders(prov({ free: [{ provider_id: 9 }] })), ['Amazon Prime']);
  assert.deepEqual(extServicesFromProviders(prov({ flatrate: [{ provider_id: 15 }] })), []); // Hulu だけ＝出さない
  assert.deepEqual(extServicesFromProviders({ results: {} }), []); // 日本のデータなし
});

test('入場：前に選んだサービス → それ（覚え直さない）', () => {
  assert.deepEqual(entryTarget({ chosen: 'Disney+', avail: { ok: true, names: ['Netflix'] } }), { service: 'Disney+', auto: false });
});

test('入場：配信が1つ → それを自動で（覚える）／2つ以上・0件・取れない → 選んでもらう', () => {
  assert.deepEqual(entryTarget({ avail: { ok: true, names: ['Netflix'] } }), { service: 'Netflix', auto: true });
  assert.equal(entryTarget({ avail: { ok: true, names: ['Netflix', 'Disney+'] } }), null);
  assert.equal(entryTarget({ avail: { ok: true, names: [] } }), null);
  assert.equal(entryTarget({ avail: { ok: false, names: [] } }), null);
  assert.equal(entryTarget({ avail: null }), null);
  assert.equal(entryTarget({ chosen: 'Hulu', avail: null }), null); // 対応外の古い選択は使わない
});

test('シートの並び：配信あり → 契約中 → その他（3つ全部）', () => {
  assert.deepEqual(sheetOrder({ avail: { ok: true, names: ['Disney+'] }, contracted: ['Amazon Prime'] }), ['Disney+', 'Amazon Prime', 'Netflix']);
  assert.deepEqual(sheetOrder({ avail: null, contracted: [] }), ['Netflix', 'Amazon Prime', 'Disney+']);
  assert.deepEqual(sheetOrder({ avail: { ok: false, names: ['Disney+'] } }), ['Netflix', 'Amazon Prime', 'Disney+']);
});

test('名前：Amazon Prime は Prime Video と書く', () => {
  assert.equal(serviceLabel('Amazon Prime'), 'Prime Video');
  assert.equal(serviceLabel('Netflix'), 'Netflix');
});
