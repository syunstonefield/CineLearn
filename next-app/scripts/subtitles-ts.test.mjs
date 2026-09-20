// lib/subtitles.js attachBaseTimestamps の単体テスト: tsSec は example 基準（findWordCueSec）・plus は null。
//   字幕tsSec二重パスの罠（配信/保存の両系統が同じ照合器 wordMatchRegex を使う）の回帰防止。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachBaseTimestamps, parseSrt, exampleContainsWord } from '../lib/subtitles.js';

// 同じ語 "negotiate" が 0:10 と 5:00 に出る小さな SRT。OP テロップ（♪）は 0:02 に置く。
const SRT = `1
00:00:02,000 --> 00:00:04,000
♪ Suits 1x01 ♪

2
00:00:10,000 --> 00:00:12,000
We need to negotiate the terms today.

3
00:01:30,000 --> 00:01:32,000
The deposition is scheduled for Monday.

4
00:05:00,000 --> 00:05:03,000
I won't negotiate with a liar.

5
00:07:15,000 --> 00:07:17,000
She ran out of the room.
`;

test('tsSec は example と最も一致するキューの時刻になる（先頭一致ではない）', () => {
  const words = [{ word: 'negotiate', source: 'drama', example: "I won't negotiate with a liar." }];
  attachBaseTimestamps(words, { title: 'Suits', season: 1, episode: 1, rawSrt: SRT });
  assert.equal(words[0].tsSec, 300); // 0:05:00 ＝ example の出現箇所
  assert.equal(words[0].tsLabel, '5:00');
});

test('example が無い語は「語を含む最初のキュー」にフォールバック', () => {
  const words = [{ word: 'negotiate', source: 'drama', example: '' }];
  attachBaseTimestamps(words, { title: 'Suits', season: 1, episode: 1, rawSrt: SRT });
  assert.equal(words[0].tsSec, 10);
  assert.equal(words[0].tsLabel, '0:10');
});

test('活用形（ran → run）でも当たる＝配信側の exampleContainsWord と同じ照合器', () => {
  const words = [{ word: 'run', source: 'drama', example: 'She ran out of the room.' }];
  assert.equal(exampleContainsWord(words[0].example, 'run'), true);
  attachBaseTimestamps(words, { title: 'Suits', season: 1, episode: 1, rawSrt: SRT });
  assert.equal(words[0].tsSec, 435); // 0:07:15
  assert.equal(words[0].tsLabel, '7:15');
});

test('plus 語（字幕外の作例）は tsSec/tsLabel とも null。字幕に無い drama 語も null', () => {
  const words = [
    { word: 'negotiate', source: 'plus', example: 'Companies negotiate every day.' },
    { word: 'subpoena', source: 'drama', example: 'They served a subpoena.' },
  ];
  attachBaseTimestamps(words, { title: 'Suits', season: 1, episode: 1, rawSrt: SRT });
  assert.equal(words[0].tsSec, null);
  assert.equal(words[0].tsLabel, null);
  assert.equal(words[1].tsSec, null);
  assert.equal(words[1].tsLabel, null);
});

test('メタ行（♪ テロップ）は照合対象にならない', () => {
  const words = [{ word: 'suits', source: 'drama', example: '' }];
  attachBaseTimestamps(words, { title: 'Suits', season: 1, episode: 1, rawSrt: SRT });
  assert.equal(words[0].tsSec, null);
});

test('rawSrt 無しなら全語 null（Infinity を漏らさない）', () => {
  const words = [{ word: 'negotiate', source: 'drama', example: 'x' }];
  attachBaseTimestamps(words, { title: 'Suits', season: 1, episode: 1, rawSrt: '' });
  assert.equal(words[0].tsSec, null);
  assert.equal(words[0].tsLabel, null);
});

test('parseSrt は台詞だけを結合しタイムコード・番号・タグを落とす', () => {
  const text = parseSrt(SRT);
  assert.ok(text.includes('We need to negotiate the terms today.'));
  assert.ok(!text.includes('-->'));
  assert.ok(!/\n\d+\n/.test(text));
});
