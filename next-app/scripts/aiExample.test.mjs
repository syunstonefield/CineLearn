// 2026-10-31 AI 作例の文頭の偏り（v1 は「Honestly, …」に偏った）対策の検査。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_EXAMPLE_SHAPES, aiExampleNeedsRedo, buildAiExamplePrompt, hasFillerOpener, hasProperNoun, pickAiExampleShape } from '../lib/aiExample.js';

test('決まった書き出しを見分ける（内容のある語で始まる文は通す）', () => {
  for (const s of ["Honestly, I'm surprised.", 'Well, that went fine.', 'So, about the merger…', 'Look, we need this.', 'You know, it works.', '"Okay, fine."']) {
    assert.equal(hasFillerOpener(s), true, s);
  }
  for (const s of ['So far the deal looks good.', 'No one saw the merger coming.', 'Now that we signed it, relax.', 'Well-planned acquisitions pay off.', 'Did the mergers go through?']) {
    assert.equal(hasFillerOpener(s), false, s);
  }
});

test('文の型は語で決まり（毎回同じ）、語が違えば散らばる', () => {
  assert.equal(pickAiExampleShape('mergers'), pickAiExampleShape('Mergers'));
  const words = ['symmetry', 'mergers', 'acquisitions', 'anchored', 'retainer', 'leverage', 'deposition', 'settlement', 'subpoena', 'partner'];
  const used = new Set(words.map(pickAiExampleShape));
  assert.ok(used.size >= 4, `型の種類が少なすぎる: ${used.size}`);
  for (const s of used) assert.ok(AI_EXAMPLE_SHAPES.includes(s));
});

test('プロンプトは語・品詞・語義と文の型だけ（作品名・字幕の行は入らない）', () => {
  const p = buildAiExamplePrompt({ word: 'mergers', pos: '名詞', sense: '合併' });
  assert.match(p, /"mergers"/);
  assert.ok(p.includes(pickAiExampleShape('mergers')));
  assert.match(p, /Honestly/); // 禁止の指示として
  assert.match(p, /固有名詞は使わない/);
  assert.doesNotMatch(p, /前回は/);
  assert.match(buildAiExamplePrompt({ word: 'mergers', retry: true }), /前回は/);
});

test('文中の固有名詞（人名など）を見分ける。I・略語・文頭は通す', () => {
  assert.equal(hasProperNoun('Did you hear about the promotion Sarah got last week?'), true);
  assert.equal(hasProperNoun('We flew to "Paris" for the merger.'), true);
  for (const s of ["I'm sure I won't negotiate.", 'The CEO wants the HR report?', 'Nobody trusts the deal, OK?', '"The symmetry is calming."']) {
    assert.equal(hasProperNoun(s), false, s);
  }
  assert.equal(aiExampleNeedsRedo("Honestly, it's fine."), true);
  assert.equal(aiExampleNeedsRedo('The symmetry of this room calms me down.'), false);
});
