// 2026-11-12 カード中心: 作品を選んだあとのカードに出す語と枚数（lib/cardDeck.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardCandidates, cardCount, takeCards, seenCount, CARDS_FIRST_COUNT } from '../lib/cardDeck.js';

const W = (word, level = 'B1') => ({ word, level, definition: 'x' });
const today = '2026-11-12';

test('出す語: 「知ってる」で外した語と、答えて期日がまだの語は出さない・期日が来た語は出す・新出が先', () => {
  const words = [W('due', 'B1'), W('fresh', 'A2'), W('skipped'), W('later'), W('hard', 'C1')];
  const srs = {
    due: { dueDate: '2026-11-12', repetitions: 1, interval: 1, easeFactor: 2.5 },
    skipped: { skipped: true },
    later: { dueDate: '2026-11-15', repetitions: 1, interval: 3, easeFactor: 2.5 },
  };
  const out = cardCandidates(words, srs, today).map((w) => w.word);
  assert.ok(!out.includes('skipped') && !out.includes('later'));
  assert.deepEqual(out.slice(0, 2).sort(), ['fresh', 'hard']); // 新出（SRS に無い）が先
  assert.ok(out.includes('due'));
});

test('枚数: 初めては5・2回目からは設定（15/30/全部）・残りの単語も見るは最後まで', () => {
  assert.equal(cardCount({ first: true, setting: 30 }), CARDS_FIRST_COUNT);
  assert.equal(cardCount({ setting: 30 }), 30);
  assert.equal(cardCount({ setting: 15 }), 15);
  assert.equal(cardCount({ setting: 0 }), null);
  assert.equal(cardCount({ setting: undefined }), 15);
  assert.equal(cardCount({ rest: true, first: true }), null);
  assert.equal(takeCards([1, 2, 3], 2).length, 2);
  assert.equal(takeCards([1, 2, 3], null).length, 3);
});

test('見ておいた語の数: SRS に記録があり外していない語', () => {
  assert.equal(seenCount([W('a'), W('b'), W('c')], { a: { repetitions: 0 }, b: { skipped: true } }), 1);
});
