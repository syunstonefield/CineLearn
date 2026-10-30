// 語ごとの固定難易度表（CEFR-J 1.6 ＋ Octanove C1/C2）と レベル判定のテスト・2026-10-30
//   lib/server/wordLevel.js は 'server-only' を import する（素の Node では解決できない）ため、
//   ここでは同じ JSON を fs で読み、純関数 createWordLevelLookup に渡して検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { createWordLevelLookup, makeFilterLevelOf, tablePosOf, CEFR_ORDER } = await import('../lib/wordLevelLookup.js');
const { personalizeWords, parsePersonalize, selectIndices } = await import('../lib/personalize.js');
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
  const all = (doc) => Object.values(doc.levels).flatMap((d) => Object.values(d));
  assert.ok(all(CEFRJ).every((l) => ['A1', 'A2', 'B1', 'B2'].includes(l)));
  assert.ok(all(OCT).every((l) => ['C1', 'C2'].includes(l)));
  // 品詞ごとの段階を持つ（2026-10-30〜）
  assert.deepEqual(CEFRJ.levels.go, { noun: 'B1', verb: 'A1' });
  assert.deepEqual(OCT.levels.engineer, { verb: 'C1' });
  assert.ok(OCT._modified.includes('vern→verb'));
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

// ── 品詞を合わせる・原形化しない（単語リストの絞り込み用・2026-10-30）──────────
test('品詞の対応（日本語・英語・併記・括弧つき）と、表に無い品詞は空', () => {
  assert.deepEqual(tablePosOf('名詞'), ['noun']);
  assert.deepEqual(tablePosOf('verb'), ['verb']);
  assert.deepEqual(tablePosOf('名詞/動詞'), ['noun', 'verb']);
  assert.deepEqual(tablePosOf('動詞（過去分詞）'), ['verb']);
  assert.deepEqual(tablePosOf('句動詞'), []);
  assert.deepEqual(tablePosOf('固有名詞'), []);
  assert.deepEqual(tablePosOf(''), []);
});

test('品詞を合わせると、別の品詞の段階を誤って使わない（skirt 動詞・engineer 動詞）', () => {
  assert.equal(lookup('skirt').level, 'A1'); // 品詞を問わなければ名詞の A1
  assert.equal(lookup('skirt', { pos: '動詞' }), null); // 動詞は表に無い → AI のまま
  assert.equal(lookup('skirt', { pos: '名詞' }).level, 'A1');
  assert.deepEqual(lookup('engineer', { pos: '動詞' }), { level: 'C1', src: 'octanove', via: 'exact', key: 'engineer' });
  assert.equal(lookup('engineer', { pos: 'noun' }).level, 'A1');
  assert.equal(lookup('go', { pos: '名詞' }).level, 'B1');
  assert.equal(lookup('go', { pos: '名詞/動詞' }).level, 'A1'); // 併記は易しい方
  assert.equal(lookup('give up', { pos: '句動詞' }), null);
});

test('exactOnly は原形化しない（fell を fall にしない）', () => {
  assert.equal(lookup('went').key, 'go');
  assert.equal(lookup('went', { exactOnly: true }), null);
  assert.equal(lookup('fell', { pos: '動詞', exactOnly: true }), null);
  assert.equal(lookup('manage', { pos: '動詞', exactOnly: true }).level, 'A2');
});

test('絞り込み用の段階: 単語・context 以外・品詞一致・原形化なし', () => {
  const lv = makeFilterLevelOf(lookup);
  assert.equal(lv({ word: 'hospital', pos: '名詞', level: 'A2' }), 'A1');
  assert.equal(lv({ word: 'skirt', pos: '動詞', level: 'B2' }), null);
  assert.equal(lv({ word: 'hospital', pos: '名詞', tier: 'context', level: 'A2' }), null);
  assert.equal(lv({ word: 'according to', pos: '前置詞', level: 'B1' }), null);
  assert.equal(lv({ word: 'stopped', pos: '動詞', level: 'A2' }), null);
  assert.equal(lv({ word: 'gonna', pos: '動詞', level: 'B1' }), null);
});

// ── サーバでの絞り込み（personalizeWords の levelOf・selectIndices）─────────────
const W = (word, level, pos = '名詞', extra = {}) => ({ word, level, pos, source: 'drama', ...extra });

test('levelOf の段階が優先され、表に無い語は AI の level で絞る', () => {
  // TOEIC 700（B1）・目標未設定（900＝B2）→ 残る段階 A2〜B2
  const words = [W('hospital', 'A2'), W('skirt', 'B2', '動詞'), W('gonna', 'B1', '動詞'), W('meticulous', 'C1', '形容詞')];
  const opts = { toeicScore: 700, targetToeicScore: 0, vocabCount: 30 };
  const ai = personalizeWords(words, opts).map((w) => w.word);
  const tbl = personalizeWords(words, { ...opts, levelOf: makeFilterLevelOf(lookup) }).map((w) => w.word);
  assert.ok(ai.includes('hospital')); // AI A2 → 残る
  assert.ok(!tbl.includes('hospital')); // 表 A1 → 落ちる
  assert.ok(tbl.includes('skirt') && tbl.includes('gonna')); // 表に無い（品詞違い・口語）→ AI のまま残る
  assert.ok(!tbl.includes('meticulous')); // 表 C2・AI C1 どちらでも帯の外
});

test('selectIndices は添字だけを返し、語オブジェクト（AI の level）は変えない', () => {
  const words = [W('hospital', 'A2'), W('settlement', 'B2'), W('skirt', 'B2', '動詞')]; // negotiate は既知語の除外リストに入るので使わない
  const before = JSON.stringify(words);
  const idx = selectIndices(words, { toeicScore: 700, targetToeicScore: 0, vocabCount: 30, levelOf: makeFilterLevelOf(lookup) });
  assert.deepEqual(idx, [1, 2]);
  assert.equal(JSON.stringify(words), before); // 表の値が語に書き込まれていない
  assert.equal(selectIndices(null, {}), null);
});

test('TOEIC 未設定なら段階では絞らない（今までと同じ）', () => {
  const words = [W('hospital', 'A2'), W('meticulous', 'C1', '形容詞')];
  assert.deepEqual(selectIndices(words, { toeicScore: 0, levelOf: makeFilterLevelOf(lookup) }), [0, 1]);
});

test('parsePersonalize: 範囲に丸め、不正は null', () => {
  assert.deepEqual(parsePersonalize({ toeicScore: 700, targetToeicScore: 900, vocabCount: 30 }), { toeicScore: 700, targetToeicScore: 900, vocabCount: 30 });
  assert.deepEqual(parsePersonalize({ toeicScore: 5000, targetToeicScore: -3, vocabCount: 'x' }), { toeicScore: 990, targetToeicScore: 0, vocabCount: 30 });
  assert.equal(parsePersonalize(null), null);
  assert.equal(parsePersonalize('700'), null);
  assert.equal(parsePersonalize([700]), null);
});

// ── 単語リストの「CEFR目安」表示（2026-10-30）──────────────────────────
const { attachDisplayLevels } = await import('../lib/wordLevelLookup.js');
const { cefrHintOf } = await import('../lib/cefrHint.js');

test('CEFR目安の値: levelShown（表）があればそれ、無ければ AI の level。複数語・不正値は出さない', () => {
  assert.equal(cefrHintOf({ word: 'hospital', level: 'A2' }), 'A2'); // (B)
  assert.equal(cefrHintOf({ word: 'hospital', level: 'A2', levelShown: 'A1' }), 'A1'); // (A)
  assert.equal(cefrHintOf({ word: 'give up', level: 'B1' }), null); // 句動詞
  assert.equal(cefrHintOf({ word: 'handshake deal', level: 'B2', tier: 'context' }), null);
  assert.equal(cefrHintOf({ word: 'buddy', level: 'b1' }), 'B1');
  assert.equal(cefrHintOf({ word: 'buddy', level: '' }), null);
  assert.equal(cefrHintOf({ word: 'buddy', level: 'N/A' }), null);
  assert.equal(cefrHintOf(null), null);
});

test('(A) の表示用段階は表で品詞一致して引けた語だけに添え、元の語は書き換えない', () => {
  const words = [W('hospital', 'A2'), W('skirt', 'B2', '動詞'), W('give up', 'B1', '句動詞')];
  const before = JSON.stringify(words);
  const out = attachDisplayLevels(words, makeFilterLevelOf(lookup));
  assert.equal(out[0].levelShown, 'A1');
  assert.equal(out[0].level, 'A2'); // AI の level は残す
  assert.equal(out[1].levelShown, undefined); // 品詞違い → AI のまま
  assert.equal(out[2].levelShown, undefined); // 複数語
  assert.equal(JSON.stringify(words), before); // 共有キャッシュへ書く元の配列は不変
  assert.deepEqual(out.map(cefrHintOf), ['A1', 'B2', null]);
});
