// 2026-10-20 /decide A（docs/decision-manual-example-matching-2026-10-20.md）の単体テスト。
//   変化形の補強は「規則で安全なもの（-es・不規則動詞）」と「対応表の語だけ（比較級・ves・英米綴り・ハイフン）」。
//   誤一致は生成時に plus→drama 昇格で出所付きの引用になるため、避けたい一致もここで固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleContainsWord, getWordVariants, VARIANTS_PER_TOKEN_MAX } from '../lib/subtitles.js';
import { capDramaExamples } from '../lib/server/vocabGen.js';
import { EXAMPLES_PER_EPISODE_MAX, EXAMPLES_PER_EPISODE_FLOOR } from '../lib/server/constants.js';

const SHOULD_MATCH = [
  ['watch', 'He watches every move we make.'],
  ['witness', 'We have two witnesses.'],
  ['box', 'Put the boxes in the car.'],
  ['crash', 'The market crashes every year.'],
  ['veto', 'He vetoes everything.'],
  ['strong', "He's stronger than he looks."],
  ['stronger', 'He is strong.'],
  ['happy', "I've never been happier."],
  ['big', 'The biggest case of my life.'],
  ['safe', "It's safer here."],
  ['knife', 'Drop the knives.'],
  ['flee', 'They fled the city.'],
  ['seek', 'He sought legal advice.'],
  ['swear', 'I swore to protect you.'],
  ['deal', 'He dealt the cards.'],
  ['forgive', 'I forgave him.'],
  ['slide', 'It slid off the table.'],
  ['realize', 'I realised it too late.'],
  ['realised', 'I realized it too late.'],
  ['color', 'What colour is it?'],
  ['honoured', 'It is an honor.'],
  ['defense', 'The defence rests.'],
  ['email', 'Send me an e-mail.'],
  // 従来から取れていたもの（回帰）
  ['stop', 'He stopped.'],
  ['cancel', 'They cancelled the meeting.'],
  ['plead', 'He pleaded guilty.'],
  ['run', 'She ran out of the room.'],
  ['try', 'He tried.'],
];

const SHOULD_NOT_MATCH = [
  ['numb', 'Give me the number.'],
  ['fill', 'I filed it.'],
  ['setup', 'set up the camp'],
  ['safe', 'He saves it.'],
  ['floor', 'a cup of flour'],
  ['life', 'He lives here.'],
  ['leaf', 'She leaves now.'],
  ['rise', 'a red rose'],
  ['light', 'Got a lighter?'],
  ['late', 'See you later.'],
  ['ham', 'Hand me the hammer.'],
  ['sum', 'See you in summer.'],
  ['corn', 'Turn the corner.'],
  ['bear', 'He was born here.'],
  ['draw', 'Drew said so.'],
  ['tear', 'He tore it up.'],
  ['bind', 'We are bound to win.'],
  ['lie', 'He lay on the bed.'],
  ['us', 'He uses it.'],
  ['to', 'Mind your toes.'],
];

test('A: 狙った変化形に一致する', () => {
  for (const [w, s] of SHOULD_MATCH) assert.equal(exampleContainsWord(s, w), true, `${w} | ${s}`);
});

test('A: 別の語には一致しない（誤一致は出所付き引用になるため固定）', () => {
  for (const [w, s] of SHOULD_NOT_MATCH) assert.equal(exampleContainsWord(s, w), false, `${w} | ${s}`);
});

test('A: 活用形候補の数は上限より十分小さい（上限で基本形が切られない）', () => {
  for (const w of ['be', 'realize', 'organization', 'strong', 'happy', 'swear', 'understand', 'withdraw', 'favourite', 'colour', 'knife']) {
    const n = getWordVariants(w).size;
    assert.ok(n <= VARIANTS_PER_TOKEN_MAX / 2, `${w}: ${n}`);
  }
});

test('A: 例文数の上限は既存の最大（152件）を削らず、超えた drama 語だけ例文と📍を空にする', () => {
  assert.ok(EXAMPLES_PER_EPISODE_MAX >= 152);
  const mk = (n, src = 'drama') => Array.from({ length: n }, (_, i) => ({ word: `w${i}`, source: src, example: `say w${i}`, example_ja: 'x', tsSec: i, tsLabel: 'l' }));
  // キュー1000 → 上限 min(160, 300) = 160
  const words = [...mk(170), ...mk(5, 'plus')];
  assert.equal(capDramaExamples(words, 1000), 10);
  assert.equal(words.filter((w) => w.source === 'drama' && w.example).length, EXAMPLES_PER_EPISODE_MAX);
  assert.deepEqual([words[165].example, words[165].tsSec, words[165].example_ja], ['', null, '']);
  assert.equal(words[170].source, 'plus'); // plus は数えない・触らない
  assert.equal(words[170].example, 'say w0');
  // 短い話でも下限までは許す（キュー50 → 上限 max(40, 15) = 40）
  const few = mk(45);
  assert.equal(capDramaExamples(few, 50), 45 - EXAMPLES_PER_EPISODE_FLOOR);
  // 上限内なら何もしない
  assert.equal(capDramaExamples(mk(30), 600), 0);
});
