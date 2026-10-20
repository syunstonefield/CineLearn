// 2026-10-20 /decide（docs/decision-manual-example-matching-2026-10-20.md）C・B の単体テスト。
//   C: 3つのパーサ（parseSrt・parseCues・parseServeCues）を splitSrtCues に一本化。形式崩れの SRT でも
//      キューが正しく分かれ、配信（findExampleForWord）と生成（attachBaseTimestamps）の秒が一致する。
//   B: ♪〜♪ は本文ごと除外・♪で始まり閉じが無い行は行ごと除外・単独の♪は記号だけ消す。
//      クレジット・URL のキューは丸ごと除外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitSrtCues,
  parseSrt,
  findExampleForWord,
  attachBaseTimestamps,
  SRT_MAX_CUES,
  CUE_MAX_CHARS,
} from '../lib/subtitles.js';

const BASE = `1
00:00:05,000 --> 00:00:07,000
Previously on Suits...

2
00:00:20,000 --> 00:00:22,000
We need to make a sacrifice.

3
00:00:30,000 --> 00:00:32,000
- Is that a retainer?
- It's a retainer.
`;

// 配信経路と生成経路の秒が同じであること（字幕tsSec二重パスの罠の回帰防止）
function bothSec(raw, word, example = '') {
  const serve = findExampleForWord(raw, word)?.sec ?? null;
  const w = [{ word, source: 'drama', example }];
  attachBaseTimestamps(w, { title: `t${Math.random()}`, season: 1, episode: 1, rawSrt: raw });
  return { serve, gen: w[0].tsSec };
}

test('C: 正常な SRT は3キュー・本文と秒が正しい', () => {
  const cues = splitSrtCues(BASE);
  assert.deepEqual(
    cues.map((c) => c.sec),
    [5, 20, 30]
  );
  assert.equal(cues[2].text, "- Is that a retainer? - It's a retainer.");
});

for (const [name, raw] of [
  ['空行に空白が混じる', BASE.replace(/\n\n/g, '\n  \n')],
  ['空行が無い', BASE.replace(/\n\n/g, '\n')],
  ['改行が CR だけ', BASE.replace(/\n/g, '\r')],
  ['改行が CRLF', BASE.replace(/\n/g, '\r\n')],
  ['先頭に BOM', '﻿' + BASE],
]) {
  test(`C: 形式崩れ（${name}）でも3キューに分かれ、配信と生成の秒が一致`, () => {
    const cues = splitSrtCues(raw);
    assert.deepEqual(
      cues.map((c) => c.sec),
      [5, 20, 30],
      name
    );
    assert.ok(!cues.some((c) => /-->|^\d+$/.test(c.text)), 'タイムスタンプ・番号が本文に混ざらない');
    const { serve, gen } = bothSec(raw, 'retainer');
    assert.equal(serve, 30);
    assert.equal(gen, 30);
  });
}

test('C: parseSrt は台詞だけを結合（タイムコード・番号・タグを落とす）', () => {
  const text = parseSrt(BASE.replace('We need', '<i>We</i> need'));
  assert.equal(text, "Previously on Suits... We need to make a sacrifice. - Is that a retainer? - It's a retainer.");
});

test('C: 上限（キュー数・1キューの長さ）', () => {
  const many = Array.from({ length: SRT_MAX_CUES + 50 }, (_, i) => `${i + 1}\n00:00:01,000 --> 00:00:02,000\nline ${i}\n`).join('\n');
  assert.equal(splitSrtCues(many).length, SRT_MAX_CUES);
  const long = `1\n00:00:01,000 --> 00:00:02,000\n${'word '.repeat(1000)}\n`;
  assert.ok(splitSrtCues(long)[0].text.length <= CUE_MAX_CHARS);
});

const LYRICS = `1
00:00:02,000 --> 00:00:04,000
♪ Suits 1x01 ♪

2
00:00:10,000 --> 00:00:12,000
He said ♪ hmm, I need a doctor.

3
00:00:20,000 --> 00:00:22,000
♪ Take me to the doctor
tonight ♪

4
00:00:30,000 --> 00:00:32,000
♪ la la la ♪ Call the doctor now.

5
00:00:40,000 --> 00:00:42,000
♪ Walking on sunshine
`;

test('B: ♪〜♪ は本文ごと除外・閉じの無い♪始まり行は行ごと除外・単独♪は記号だけ消す', () => {
  const cues = splitSrtCues(LYRICS);
  assert.deepEqual(
    cues.map((c) => [c.sec, c.text]),
    [
      [10, 'He said hmm, I need a doctor.'],
      [30, 'Call the doctor now.'],
    ]
  );
  assert.ok(!parseSrt(LYRICS).includes('sunshine'));
  assert.ok(!parseSrt(LYRICS).includes('Take me'));
});

test('B: 単独♪の行（台詞）は配信と生成で同じ秒（engineer 提案の固定ケース）', () => {
  const { serve, gen } = bothSec(LYRICS, 'doctor', 'He said hmm, I need a doctor.');
  assert.equal(serve, 10);
  assert.equal(gen, 10);
});

test('B: クレジット・URL のキューは丸ごと除外', () => {
  const raw = `1
00:00:01,000 --> 00:00:03,000
Subtitles by explosiveskull

2
00:00:04,000 --> 00:00:06,000
Sync and corrections by n17t01
www.addic7ed.com

3
00:00:07,000 --> 00:00:09,000
Support us and become VIP member
to remove all ads from https://example.org

4
00:00:10,000 --> 00:00:12,000
Original Air Date on October 1, 2026

5
00:00:20,000 --> 00:00:22,000
I'm a lawyer, not a doctor.
`;
  assert.deepEqual(
    splitSrtCues(raw).map((c) => c.sec),
    [20]
  );
});

test('B: 台詞は残る（ドット・数字・ハイフン・斜体タグ）', () => {
  const raw = `1
00:00:01,000 --> 00:00:03,000
<i>It's 50-50, Harvey.</i>

2
00:00:04,000 --> 00:00:06,000
Mr. Specter... wait.
`;
  assert.deepEqual(
    splitSrtCues(raw).map((c) => c.text),
    ["It's 50-50, Harvey.", 'Mr. Specter... wait.']
  );
});
