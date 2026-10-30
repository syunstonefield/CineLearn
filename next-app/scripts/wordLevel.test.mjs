// 語ごとの固定難易度表（CEFR-J 1.6 ＋ Octanove C1/C2）と レベル判定のテスト・2026-10-30
//   lib/server/wordLevel.js は 'server-only' を import する（素の Node では解決できない）ため、
//   ここでは同じ JSON を fs で読み、純関数 createWordLevelLookup に渡して検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { createWordLevelLookup, CEFR_ORDER } = await import('../lib/wordLevelLookup.js');
const { firstQualityByLevel, estimateBoundary } = await import('../lib/levelEstimate.js');

const raw = (f) => readFileSync(join(ROOT, 'lib/data', f), 'utf8');
const CEFRJ = JSON.parse(raw('cefrj-wordlist-1.6.json'));
const OCT = JSON.parse(raw('octanove-c1c2-1.0.json'));
const lookup = createWordLevelLookup([
  { id: 'cefrj', levels: CEFRJ.levels },
  { id: 'octanove', levels: OCT.levels },
]);

// ── 法務の条件（形式）────────────────────────────────
test('出典ごとに別ファイル・先頭に _source/_license/_modified/_retrieved（法務 条件2）', () => {
  for (const [name, doc] of [['cefrj', CEFRJ], ['octanove', OCT]]) {
    const keys = Object.keys(doc);
    assert.deepEqual(keys.slice(0, 4), ['_source', '_license', '_modified', '_retrieved'], name);
    assert.match(doc._retrieved, /^\d{4}-\d{2}-\d{2}$/, name);
    assert.ok(doc._modified.includes('易しい方'), name);
    assert.ok(Object.keys(doc.levels).length > 1000, name);
  }
  assert.match(CEFRJ._source, /CEFR-J Wordlist Version 1\.6/);
  assert.match(CEFRJ._source, /Tono/);
  assert.match(OCT._source, /Octanove/);
  assert.match(OCT._license, /CC BY-SA 4\.0/);
  // 1ファイルに混ぜない: CEFR-J は A1〜B2 だけ、Octanove は C1/C2 だけ
  assert.ok(Object.values(CEFRJ.levels).every((l) => ['A1', 'A2', 'B1', 'B2'].includes(l)));
  assert.ok(Object.values(OCT.levels).every((l) => ['C1', 'C2'].includes(l)));
});

test('表の見出し語はすべてその語のまま引ける（\'m / mr. / a.m. のような記号つきも）', () => {
  const bad = [];
  for (const doc of [CEFRJ, OCT]) {
    for (const w of Object.keys(doc.levels)) {
      const r = lookup(w);
      if (!r || r.via !== 'exact' || r.key !== w) bad.push(w);
    }
  }
  assert.deepEqual(bad, []);
  assert.equal(lookup('Mr.').key, 'mr.');
  assert.equal(lookup('a.m.').level, 'A1'); // 略語のピリオドは残す
  assert.equal(lookup('Hello.').key, 'hello'); // 文末のピリオドは落とす
});

// 表をクライアントへ配らない（法務 条件4）: lib/data の JSON を import してよいのは lib/server/ だけ、
// lib/server/wordLevel を import するファイルは 'use client' であってはならない。
test('表を import しているのはサーバ専用ファイルだけ（法務 条件4）', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|jsx|tsx?)$/.test(name)) files.push(p);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(join(ROOT, d));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f);
    if (/data\/(cefrj-wordlist|octanove-c1c2)/.test(src)) {
      assert.ok(rel.startsWith('lib/server/'), `${rel} が表の JSON を直接 import している`);
      assert.match(src, /import 'server-only'/, `${rel} に server-only が無い`);
    }
    if (/server\/wordLevel['"]/.test(src)) {
      assert.ok(!/^\s*['"]use client['"]/m.test(src), `${rel} はクライアント部品なのに表を import している`);
    }
  }
});

// ── lookup ──────────────────────────────────────────
test('そのまま引ける語', () => {
  assert.deepEqual(lookup('manage'), { level: 'A2', src: 'cefrj', via: 'exact', key: 'manage' });
  assert.equal(lookup('Abandon').level, 'B1'); // 大文字
  assert.equal(lookup('"Hello!"').level, 'A1'); // 引用符・記号
  assert.equal(lookup('according to').level, 'B1'); // 複数語
  assert.equal(lookup('meticulous').src, 'octanove');
  assert.ok(['C1', 'C2'].includes(lookup('scrutiny').level));
});

test('品詞違いは易しい方（run 名詞/動詞 → A1）', () => {
  assert.equal(lookup('run').level, 'A1');
  assert.equal(lookup('go').level, 'A1');
});

test('両方の表にある語は易しい方（CEFR-J）を採る', () => {
  const both = Object.keys(OCT.levels).filter((w) => CEFRJ.levels[w]);
  assert.ok(both.length > 0);
  for (const w of both) assert.equal(lookup(w).src, 'cefrj', w);
});

test('原形に戻して引く（不規則形・-s・-ed・-ing・比較級・句動詞の先頭語）', () => {
  const cases = {
    went: 'go', children: 'child', stories: 'story', watches: 'watch', stopped: 'stop',
    making: 'make', lying: 'lie', happier: 'happy', bigger: 'big', lives: 'life',
  };
  for (const [w, key] of Object.entries(cases)) {
    const r = lookup(w);
    assert.ok(r, w);
    assert.equal(r.via, 'lemma', w);
    assert.equal(r.key, key, w);
  }
  const ph = lookup('turned to');
  assert.equal(ph.key, 'turn to');
  assert.equal(ph.via, 'lemma');
});

test('表に無い語（口語・句動詞・空）は null＝呼び出し側で AI の level へ', () => {
  assert.equal(lookup('gonna'), null);
  assert.equal(lookup('freak out'), null);
  assert.equal(lookup(''), null);
  assert.equal(lookup(null), null);
});

// ── レベル判定（firstQuality × 段階）───────────────────
const fakeLevel = (w) => ({ a: 'A1', b: 'A2', c: 'B1', d: 'B2', e: 'C1' })[w[0]] || null;
const mk = (prefix, n, q) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, { firstQuality: q }]));

test('段階ごとに数える（firstQuality 無し・skipped は数えない・表に無い語は unleveled）', () => {
  const srs = {
    a1: { firstQuality: 5 },
    a2: { firstQuality: 3 },
    c1: { firstQuality: 0 },
    zz: { firstQuality: 5 }, // 表に無い
    a3: { firstQuality: 5, skipped: true }, // 外した語
    a4: { interval: 6 }, // 記録開始前
  };
  const s = firstQualityByLevel(srs, fakeLevel);
  assert.deepEqual(s.byLevel.A1, { recorded: 2, known: 1, shaky: 1, unknown: 0 });
  assert.deepEqual(s.byLevel.B1, { recorded: 1, known: 0, shaky: 0, unknown: 1 });
  assert.equal(s.unleveled, 1);
  assert.equal(s.recorded, 4);
  assert.deepEqual(Object.keys(s.byLevel), CEFR_ORDER);
});

test('Supabase の行の形（配列）と、段階の文字列を返す levelOf も受け付ける', () => {
  const rows = [{ word: 'a1', firstQuality: 5 }, { word: 'b1', firstQuality: 0 }, { word: 'b2', firstQuality: null }];
  const s = firstQualityByLevel(rows, (w) => fakeLevel(w));
  assert.equal(s.byLevel.A1.known, 1);
  assert.equal(s.byLevel.A2.unknown, 1);
  assert.equal(s.recorded, 2);
});

test('境目＝知ってた率が 50% を切る最初の段階', () => {
  const srs = {
    ...mk('a', 10, 5), // A1 100%
    ...mk('b', 8, 5), ...mk('bx', 2, 0), // A2 80%
    ...mk('c', 4, 5), ...mk('cx', 6, 0), // B1 40% ← 境目
    ...mk('d', 1, 0), ...mk('dx', 9, 0), // B2 0%
  };
  const r = estimateBoundary(firstQualityByLevel(srs, fakeLevel));
  assert.equal(r.reason, 'found');
  assert.equal(r.boundary, 'B1');
  assert.equal(r.rates.A2, 0.8);
});

test('うろ覚え（3）は「知ってた」に数えない', () => {
  const srs = { ...mk('a', 10, 3) };
  assert.equal(estimateBoundary(firstQualityByLevel(srs, fakeLevel)).boundary, 'A1');
});

test('語数が足りない段階は判定に使わない', () => {
  const few = { ...mk('a', 9, 0) }; // A1 は 9 語＜10
  assert.deepEqual(
    { b: estimateBoundary(firstQualityByLevel(few, fakeLevel)).boundary, r: estimateBoundary(firstQualityByLevel(few, fakeLevel)).reason },
    { b: null, r: 'not_enough_data' },
  );
  // A1 不足・A2 十分で 30% → A2 が境目（不足の段階は飛ばす）
  const skip = { ...mk('a', 3, 0), ...mk('b', 3, 5), ...mk('bx', 7, 0) };
  assert.equal(estimateBoundary(firstQualityByLevel(skip, fakeLevel)).boundary, 'A2');
  // minWords を下げれば A1 も使う
  assert.equal(estimateBoundary(firstQualityByLevel(skip, fakeLevel), { minWords: 3 }).boundary, 'A1');
});

test('どの段階も 50% 以上なら above_all', () => {
  const srs = { ...mk('a', 10, 5), ...mk('e', 6, 5), ...mk('ex', 4, 0) };
  const r = estimateBoundary(firstQualityByLevel(srs, fakeLevel));
  assert.equal(r.boundary, null);
  assert.equal(r.reason, 'above_all');
  assert.deepEqual(r.enough, ['A1', 'C1']);
});

test('本物の表と組み合わせて動く', () => {
  const srs = { went: { firstQuality: 5 }, meticulous: { firstQuality: 0 }, gonna: { firstQuality: 5 } };
  const s = firstQualityByLevel(srs, lookup);
  assert.equal(s.byLevel.A1.known, 1);
  assert.equal(s.byLevel[lookup('meticulous').level].unknown, 1);
  assert.equal(s.unleveled, 1);
});
