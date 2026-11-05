// lib/journeyCefr.js（あゆみ「段階ごとの覚えた語」）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLearnedByLevel } from '../lib/journeyCefr.js';

const W = (word, state, extra = {}) => ({ word, state, level: null, levelShown: null, pos: null, ...extra });

test('覚えた・マスターだけを段階ごとに数え、マスターは内数', () => {
  const words = [
    W('hospital', 'learned', { levelShown: 'A1', level: 'B1' }), // 表の段階が優先
    W('settle', 'mastered', { level: 'B1' }), // AI の段階
    W('negotiate', 'learned', { level: 'B2' }),
    W('roar', 'learning', { level: 'B2' }), // まだ覚えていない＝数えない
    W('divine', 'new', { level: 'C1' }),
  ];
  const r = countLearnedByLevel(words, []);
  const by = Object.fromEntries(r.rows.map((x) => [x.level, x]));
  assert.equal(by.A1.learned, 1);
  assert.equal(by.B1.learned, 1);
  assert.equal(by.B1.mastered, 1);
  assert.equal(by.B2.learned, 1);
  assert.equal(by.B2.mastered, 0);
  assert.equal(r.learned, 3);
  assert.equal(r.mastered, 1);
  assert.equal(r.table, 1);
  assert.equal(r.ai, 2);
  assert.equal(r.unleveled, 0);
  assert.equal(r.show, true);
});

test('棒の長さは最多の段階を 1 とした相対値（分母なし）', () => {
  const words = [
    W('a', 'learned', { level: 'B1' }),
    W('b', 'learned', { level: 'B1' }),
    W('c', 'mastered', { level: 'B1' }),
    W('d', 'learned', { level: 'A2' }),
  ];
  const r = countLearnedByLevel(words, []);
  const by = Object.fromEntries(r.rows.map((x) => [x.level, x]));
  assert.equal(by.B1.frac, 1);
  assert.equal(by.A2.frac, 1 / 3);
  assert.equal(by.B1.fracMastered, 1 / 3);
  assert.equal(by.C2.frac, 0);
  assert.equal(r.rows.length, 6);
  // 並びは上から C2→A1（オーナー 2026-11-05）。相対値は並びに依存しない
  assert.deepEqual(r.rows.map((x) => x.level), ['C2', 'C1', 'B2', 'B1', 'A2', 'A1']);
});

test('句動詞・言い回しや段階の無い語は「目安なし」に数える（覚えたの合計には入る）', () => {
  const words = [
    W('freak out', 'learned', { level: 'B2' }), // 複数語＝段階を付けない
    W('zork', 'mastered'), // level も levelShown も無い
    W('agree', 'learned', { level: 'A2' }),
  ];
  const r = countLearnedByLevel(words, []);
  assert.equal(r.unleveled, 2);
  assert.equal(r.learned, 3);
  assert.equal(r.mastered, 1);
  assert.equal(r.show, true);
});

test('保存語（level 無し）は履歴の同じ語から段階を借りる。品詞が食い違う語は借りない', () => {
  const history = [
    {
      drama: { title: 'Suits' },
      words: [
        { word: 'Engineer', pos: '動詞', level: 'B2', levelShown: 'C1' },
        { word: 'drama', pos: '名詞', level: 'B1', levelShown: 'A1' },
      ],
    },
  ];
  const words = [
    W('engineer', 'learned', { pos: '名詞' }), // 品詞が違う＝借りない＝目安なし
    W('drama', 'learned', { pos: '名詞' }), // 借りて A1
    W('drama', 'learned'), // 品詞無しでも借りる（collectRingWords は語で名寄せ済みなので実際は1件）
  ];
  const r = countLearnedByLevel(words, history);
  const by = Object.fromEntries(r.rows.map((x) => [x.level, x]));
  assert.equal(by.A1.learned, 2);
  assert.equal(by.C1.learned, 0);
  assert.equal(r.unleveled, 1);
  assert.equal(r.table, 2);
});

test('覚えた語が無い、または段階が1つも付かない時は show=false', () => {
  assert.equal(countLearnedByLevel([], []).show, false);
  assert.equal(countLearnedByLevel(null, null).show, false);
  const onlyPhrases = [W('pick up', 'learned', { level: 'A2' })];
  const r = countLearnedByLevel(onlyPhrases, []);
  assert.equal(r.show, false);
  assert.equal(r.unleveled, 1);
  assert.equal(r.learned, 1);
});
