// 2026-11-07 拡張 v1.2.12 のポップアップ「★ 覚えたい」（オーナー決定・2ボタン）。
//   単語帳の既定は「入れない」（my_words.in_wordbook の既定 false）。★を押した保存だけ in_wordbook:true を送る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, word, world } from './extHarness.mjs';

const loggedIn = { cl_sb_session: { access_token: 'tok-A', refresh_token: 'r-A', expires_at: Math.floor(Date.now() / 1000) + 3000, user: { id: 'A' } }, cl_last_user_id: 'A', cl_ledger_owner: 'A', cl_sync_recover_v1: 1 };
const rows = (w) => w.posts.filter((p) => p.table.startsWith('my_words')).map((p) => p.body[0]);

test('★ 覚えたい: in_wordbook:true を送る。✓ 保存は送らない', async () => {
  const w = await world(loggedIn);
  await w.settle();
  await w.save(word({ word: 'leverage', dramaTitle: 'Suits', season: 1, episode: 1, _clStar: true }));
  await w.save(word({ word: 'betray', dramaTitle: 'Suits', season: 1, episode: 1 }));
  await w.settle();
  const [starred, plain] = rows(w);
  assert.equal(starred.word, 'leverage');
  assert.equal(starred.in_wordbook, true);
  assert.equal(plain.word, 'betray');
  assert.equal('in_wordbook' in plain, false, '既定に任せる（単語帳には入れない）');
});

test('★の印は端末の台帳に残さない＝後でただ保存し直しても、アプリで外した★を付け直さない', async () => {
  const w = await world(loggedIn);
  await w.settle();
  await w.save(word({ word: 'leverage', dramaTitle: 'Suits', season: 1, episode: 1, _clStar: true }));
  assert.equal(w.store.cl_my_words.some((x) => '_clStar' in x), false);
  w.posts.length = 0;
  await w.save(word({ word: 'leverage', dramaTitle: 'Dark', season: 1, episode: 2 }));
  await w.settle();
  assert.equal('in_wordbook' in rows(w)[0], false);
});

test('保存済みの語にも★を付けられる（同じ行の送り方・例文や遭遇ログは今まで通り）', async () => {
  const w = await world({ ...loggedIn, cl_my_words: [{ word: 'leverage', ja: '交渉の切り札', dramaTitle: 'Suits', season: 1, episode: 1, savedAt: '2026-11-01', sentence: 'A line.' }] });
  await w.settle();
  await w.save(word({ word: 'leverage', dramaTitle: 'Suits', season: 1, episode: 1, _clStar: true }));
  await w.settle();
  const row = rows(w)[0];
  assert.equal(row.in_wordbook, true);
  assert.equal(row.ja, '交渉の切り札');
  assert.equal(row.sentence, 'A line.');
});

test('in_wordbook 列が無い DB: 列を外して再送し、語は届く（ts_sec は残す）。以後は送らない', async () => {
  const w = await world(loggedIn, { failPost: (table, body) => ('in_wordbook' in body[0] ? { status: 400, json: { code: 'PGRST204', message: "Could not find the 'in_wordbook' column of 'my_words' in the schema cache" } } : null) });
  await w.settle();
  await w.save(word({ word: 'leverage', dramaTitle: 'Suits', season: 1, episode: 1, tsSec: 77, _clStar: true }));
  await w.settle();
  const sent = rows(w);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].in_wordbook, undefined);
  assert.equal(sent[1].ts_sec, 77);
  assert.equal(w.store.cl_sync_pending?.length || 0, 0, '届いたのでキューに残らない');
  w.posts.length = 0;
  await w.save(word({ word: 'betray', dramaTitle: 'Suits', season: 1, episode: 1, _clStar: true }));
  await w.settle();
  assert.equal(rows(w).length, 1, '2回目からは最初から外して送る');
});

test('列名の無い PGRST204 は今まで通り ts_sec を外す（★の列は残す）', async () => {
  const w = await world(loggedIn, { failPost: (table, body) => ('ts_sec' in body[0] ? { status: 400, json: { code: 'PGRST204', message: 'column missing' } } : null) });
  await w.settle();
  await w.save(word({ word: 'leverage', dramaTitle: 'Suits', season: 1, episode: 1, tsSec: 77, _clStar: true }));
  await w.settle();
  const sent = rows(w);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].ts_sec, undefined);
  assert.equal(sent[1].in_wordbook, true);
});

test('未ログインで★を押した語は、キューに★ごと残り、ログイン後に★付きで届く', async () => {
  const w = await world();
  await w.save(word({ word: 'guestword', dramaTitle: 'Dark', season: 1, episode: 1, _clStar: true }));
  await sleep(30);
  assert.equal(w.store.cl_sync_pending[0]._clStar, true);
  assert.equal(w.store.cl_my_words.some((x) => '_clStar' in x), false);
  await w.login('A');
  await w.settle();
  assert.equal(rows(w).find((r) => r.word === 'guestword')?.in_wordbook, true);
});

test('送れるまでの間に同じ語をただ保存し直しても、★は消えない', async () => {
  const w = await world();
  await w.save(word({ word: 'guestword', dramaTitle: 'Dark', season: 1, episode: 1, _clStar: true }));
  await w.save(word({ word: 'guestword', dramaTitle: 'Dark', season: 1, episode: 2 }));
  await sleep(30);
  assert.equal(w.store.cl_sync_pending.length, 1);
  assert.equal(w.store.cl_sync_pending[0]._clStar, true);
  assert.equal(w.store.cl_sync_pending[0].episode, 2, '中身は最新の姿');
  await w.login('A');
  await w.settle();
  assert.equal(rows(w).find((r) => r.word === 'guestword')?.in_wordbook, true);
});
