// 2026-10-20 /decide（docs/decision-manual-example-matching-2026-10-20.md）の「既存の穴」修正の単体テスト。
//   ③ReDoS: /api/example の語の上限（exampleWordProblem）・活用形候補の上限・正規表現の1回生成
//   ②手動取り直しの DL ゲート: route 側の配線は exampleDlEligible（securityGuards.test.mjs で検証済み）と
//     ratelimit の IP エントリ（ipLimitsOff を外した形）をここで確認する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exampleWordProblem,
  EXAMPLE_WORD_MAX_CHARS,
  EXAMPLE_WORD_MAX_TOKENS,
} from '../lib/server/exampleGate.js';
import {
  phraseContentTokenCount,
  getWordVariants,
  VARIANTS_PER_TOKEN_MAX,
  findExampleForWord,
  findExampleByAnchor,
  exampleContainsWord,
} from '../lib/subtitles.js';
import { checkRateLimit } from '../lib/ratelimit.js';

test('語の上限: 正規の語・句動詞・慣用句は通る', () => {
  for (const w of [
    'retainer',
    'hold on',
    'pull it off',
    'keep an eye on someone',
    'take someone for granted',
    'put two and two together',
    "get one's act together",
    'subpoena',
  ]) {
    assert.equal(exampleWordProblem(w), null, w);
  }
});

test('語の上限: 意味のある語が6語以上・64文字超は too_long', () => {
  assert.equal(exampleWordProblem('deal deal deal deal deal deal'), 'too_long');
  assert.equal(exampleWordProblem('go go go go go go go go go go go go zzqx'), 'too_long');
  assert.equal(exampleWordProblem('a'.repeat(EXAMPLE_WORD_MAX_CHARS + 1)), 'too_long');
  assert.equal(exampleWordProblem('a'.repeat(EXAMPLE_WORD_MAX_CHARS)), null);
});

test('語数の数え方: 埋め草（冠詞・代名詞）は数えない＝照合器が連結する語数と同じ', () => {
  assert.equal(phraseContentTokenCount('retainer'), 1);
  assert.equal(phraseContentTokenCount('keep an eye on someone'), 3); // keep / eye / on
  assert.equal(phraseContentTokenCount('the the the'), 3); // 全部埋め草なら全語を数える（照合器と同じ）
  assert.equal(phraseContentTokenCount('deal deal deal deal deal'), EXAMPLE_WORD_MAX_TOKENS);
});

test('ReDoS: 上限内の最悪ケース（同じ語5語＋不一致語）が2000語の巨大キューでも速い', () => {
  const cue = Array(2000).fill('deal').join(' ');
  const t0 = Date.now();
  exampleContainsWord(cue, 'deal deal deal deal zzqx');
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0}ms`);
});

test('活用形候補の上限は通常の語に届かない（クイズ空欄化・生成の照合を変えない）', () => {
  for (const w of ['be', 'run', 'stop', 'happen', 'understand', 'begin', 'try', 'cancel', 'retainer', 'running', 'stopped']) {
    assert.ok(getWordVariants(w).size <= VARIANTS_PER_TOKEN_MAX, `${w}: ${getWordVariants(w).size}`);
  }
});

const SRT = `1
00:00:05,000 --> 00:00:07,000
Previously on Suits...

2
00:00:20,000 --> 00:00:22,000
We need to make a sacrifice.

3
00:00:30,000 --> 00:00:32,000
- Is that a retainer?
- It's a retainer.

4
00:01:10,000 --> 00:01:12,000
He stopped running from the retainer.
`;

test('正規表現の1回生成: findExampleForWord の結果は従来と同じ（最初の一致・near で最近傍）', () => {
  assert.equal(findExampleForWord(SRT, 'retainer').sec, 30);
  assert.equal(findExampleForWord(SRT, 'retainer', 70).sec, 70);
  assert.equal(findExampleForWord(SRT, 'retainer', 70, 5).sec, 70);
  assert.equal(findExampleForWord(SRT, 'retainer', 50, 5), null); // 窓外
  assert.equal(findExampleForWord(SRT, 'stop').sec, 70); // 活用形 stopped
  assert.equal(findExampleForWord(SRT, 'zzqx'), null);
  assert.equal(findExampleForWord(SRT, ''), null);
});

test('正規表現の1回生成: findExampleByAnchor の結果も従来と同じ', () => {
  const hit = findExampleByAnchor(SRT, 'retainer', 'He stopped running from the retainer', 0);
  assert.equal(hit?.sec, 70);
});

test('手動取り直しの DL: IP エントリが入る（ipLimitsOff を外した形）', async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const cmds = JSON.parse(init.body);
    calls.push(cmds);
    return { ok: true, json: async () => cmds.map(() => ({ result: 1 })) };
  };
  const req = new Request('https://x.test/api/example', { headers: { 'x-forwarded-for': '203.0.113.7' } });
  const r = await checkRateLimit(req, 'example-manual-dl', { perMin: 0, perHour: 0, perDay: 10 }, {
    failClosed: true,
    env: { UPSTASH_REDIS_REST_URL: 'https://u.test', UPSTASH_REDIS_REST_TOKEN: 't' },
    fetchImpl,
    extra: [{ keyBase: 'rl:example-manual-dl:user:u1', window: 'day', limit: 5, scope: 'user' }],
  });
  assert.equal(r.ok, true);
  const keys = calls[0].filter((c) => c[0] === 'INCR').map((c) => c[1]);
  assert.ok(keys.some((k) => k.startsWith('rl:example-manual-dl:203.0.113.7:')), keys.join(','));
  assert.ok(keys.some((k) => k.startsWith('rl:example-manual-dl:user:u1')), keys.join(','));
});
