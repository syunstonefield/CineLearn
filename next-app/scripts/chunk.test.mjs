// lib/chunk.js（予習カード・復習カードの「語と一緒に出る組」）の単体テスト。
//   オーナー決定 2026-11-07: 消すのは完全に不要な飾りだけ。結びつきが意味に効く組と定番の言い回しは残す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkParts } from '../lib/chunk.js';

const shown = (c, w, p) => chunkParts(c, w, p);

test('C: 句動詞・前置詞・軽い動詞の慣用句は組のまま出す（オーナー指摘の残したい例）', () => {
  for (const [c, w, p] of [
    ['dissipate into', 'dissipate', '動詞'],
    ['get ahold of', 'ahold', '名詞'],
    ['rely on', 'rely', '動詞'],
    ['accuse A of', 'accuse', '動詞'],
    ['owe you', 'owe', '動詞'],
    ['familiar with', 'familiar', '形容詞'],
    ['take care of', 'care', '名詞'],
    ['have a crush on', 'crush', '名詞'],
    ['in charge of', 'charge', '名詞'],
    ['look forward to', 'look forward', '動詞'],
  ]) {
    assert.ok(shown(c, w, p), `${c} を出す`);
  }
  assert.deepEqual(shown('dissipate into', 'dissipate', '動詞'), { before: '', hit: 'dissipate', after: ' into' });
});

test('定番の言い回し（動詞を含む組）は消さない: file a lawsuit・trigger an alert は品詞では分けない', () => {
  assert.ok(shown('file a lawsuit', 'lawsuit', '名詞'));
  assert.ok(shown('raise an objection', 'objection', '名詞'));
  assert.ok(shown('trigger an alert', 'trigger', '動詞'));
});

test('A: 確実な飾りは語だけにする（形容詞＋名詞・形容詞の形の語＋名詞）', () => {
  assert.equal(shown('quantum realm', 'quantum', '形容詞'), null);
  assert.equal(shown('catastrophic failure', 'catastrophic', '形容詞'), null);
  assert.equal(shown('demonic possession', 'possession', '名詞'), null);
  assert.equal(shown('a dangerous mission', 'mission', '名詞'), null);
});

test('名詞として使う語が前に付く組は飾りとみなさない（traffic jam・magic trick）・-al は含めない', () => {
  assert.ok(shown('traffic jam', 'jam', '名詞'));
  assert.ok(shown('magic trick', 'trick', '名詞'));
  assert.ok(shown('criminal record', 'record', '名詞'));
  assert.ok(shown('hospital bed', 'bed', '名詞'));
});

test('B: 2語以上の語は全体を強調する（make a fresh start）・離れた句は最初から最後まで', () => {
  assert.deepEqual(shown('make a fresh start', 'fresh start', '名詞'), { before: 'make a ', hit: 'fresh start', after: '' });
  assert.deepEqual(shown('pull it off', 'pull off', '動詞'), { before: '', hit: 'pull it off', after: '' });
});

test('活用形を拾う・語が組に無い時と同じ時は出さない', () => {
  assert.deepEqual(shown('looking forward to', 'look forward', '動詞'), { before: '', hit: 'looking forward', after: ' to' });
  assert.equal(shown('take a seat', 'bench', '名詞'), null);
  assert.equal(shown('possession', 'possession', '名詞'), null);
  assert.equal(shown('', 'possession', '名詞'), null);
});

test('品詞が英語表記でも同じ規則（古い保存データ）', () => {
  assert.equal(shown('quantum realm', 'quantum', 'adjective'), null);
  assert.equal(shown('demonic possession', 'possession', 'noun'), null);
});

test('生成の指示: ありふれた目的語と形容詞＋名詞の組を出さない例を書いている', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../lib/vocab.js', import.meta.url), 'utf8');
  for (const s of ["'trigger an alert'", "'quantum realm'", "'demonic possession'", "w が句なら c にも句全体を含める"]) assert.ok(src.includes(s), s);
  assert.ok(!src.includes('動詞で c が空なのは'), '「動詞は必ず c を出す」の強制を外した');
});
