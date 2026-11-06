// 2026-11-05 同じ Chrome で別アカウントに切り替えた時の混入（拡張 v1.2.12・台帳の入れ替え）。
//   拡張の実コード（background.js 全体＋content.js の関数）を偽の chrome.storage / fetch で動かす。通信は外へ出ない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clone, sess, sleep, word, world } from './extHarness.mjs';

const LEDGER_A = [
  { word: 'leverage', ja: 'Aの訳', pos: 'noun', definition: 'A def', dramaTitle: 'Suits', season: 1, episode: 1, tsSec: 1900, savedAt: '2026-10-01', sentence: 'A line.' },
  { word: 'betray', ja: '裏切る(A)', dramaTitle: 'Suits', season: 2, episode: 3, savedAt: '2026-10-02' },
];
const REUNIONS_A = [{ w: 'oldreunion', at: '2026-10-01', from: { title: 'Aの作品' }, in: { title: 'Aの別作品' } }];
const KNOWN_A = { at: Date.now(), uid: 'A', words: [{ w: 'secretofa', ja: 'Aの単語帳', title: 'Aの観た作品', kind: 'wordbook' }] };
const usedByA = () => ({ cl_sb_session: sess('A'), cl_last_user_id: 'A', cl_ledger_owner: 'A', cl_sync_recover_v1: 1, cl_my_words: LEDGER_A, cl_reunions: REUNIONS_A, cl_known_words: KNOWN_A });

test('切り替えると、B の画面に A の語が出ない（印・訳・再会の出所）', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.switchTo('B');
  w.api.refreshSavedWords();
  await w.settle();
  w.api.setTitle('suits');
  assert.deepEqual(w.api.view().mark, []);
  assert.deepEqual(w.api.view().meaning, []);
  w.api.setTitle('dark');
  assert.deepEqual(w.api.view().other, []);
  assert.deepEqual(w.store.cl_my_words, []);
});

test('B が A と同じ語を保存しても、A の作品・訳・定義・例文が B のクラウドへ入らない', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.switchTo('B');
  w.posts.length = 0;
  await w.save(word({ dramaTitle: 'Suits', season: 1, episode: 1, tsSec: 77 }));
  await w.save(word({ word: 'betray', dramaTitle: 'Dark', season: 1, episode: 2 }));
  await w.settle();
  assert.equal(w.posts.length, 2);
  for (const p of w.posts) {
    const row = p.body[0];
    assert.equal(p.as, 'B');
    assert.equal(row.user_id, 'B');
    for (const k of ['encounters', 'ja', 'definition', 'sentence', 'pos']) assert.equal(row[k], undefined, k);
  }
});

test('再会の記録は今の人の分だけ送る（切り替え前の一覧が届いても前の人の分は送らない）', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.switchTo('B');
  w.posts.length = 0;
  w.api.setCtx({ dramaTitle: 'Dark', season: 1, episode: 3 });
  w.api.recordReunion('someword', { title: 'Bの作品', kind: 'wordbook' });
  await sleep(80);
  const sent = w.posts.filter((p) => p.table === 'user_state');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].as, 'B');
  assert.deepEqual(sent[0].body[0].value.map((e) => e.w), ['someword']);
});

test('再会の一覧が空ならクラウドを空で潰さない', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.switchTo('B');
  w.posts.length = 0;
  await w.sendToBackground({ type: 'CL_PUSH_REUNIONS', payload: REUNIONS_A }); // 切り替え前の一覧が遅れて届いた形
  await w.settle();
  assert.equal(w.posts.filter((p) => p.table === 'user_state').length, 0);
});

test('A→B→A で A の台帳と再会が完全に戻り、B の分は B の控えに残る', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.switchTo('B');
  assert.deepEqual(w.store.cl_ledger_archive_A.cl_my_words, LEDGER_A);
  assert.deepEqual(w.store.cl_ledger_archive_A.cl_reunions, REUNIONS_A);
  await w.save(word({ word: 'bword', dramaTitle: 'Dark', season: 1, episode: 1 }));
  await w.switchTo('A');
  assert.deepEqual(w.store.cl_my_words, LEDGER_A);
  assert.deepEqual(w.store.cl_reunions, REUNIONS_A);
  assert.deepEqual(w.store.cl_ledger_archive_B.cl_my_words.map((x) => x.word), ['bword']);
  assert.equal(w.store.cl_ledger_archive_A, undefined, '戻した控えは片付ける');
  await w.switchTo('B');
  assert.deepEqual(w.store.cl_my_words.map((x) => x.word), ['bword']);
  assert.deepEqual(w.store.cl_ledger_archive_A.cl_my_words, LEDGER_A);
});

test('プロフィール別の台帳（cl_my_words_*）も一緒に動く', async () => {
  const w = await world({ ...usedByA(), cl_my_words_p1: [{ word: 'inprofile', savedAt: '2026-10-05' }] });
  await w.settle();
  await w.switchTo('B');
  assert.deepEqual(w.store.cl_my_words_p1, []);
  await w.switchTo('A');
  assert.deepEqual(w.store.cl_my_words_p1.map((x) => x.word), ['inprofile']);
});

test('切り替えで cl_known_words を捨てる。別の人の控えが残っていても使わない', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.switchTo('B');
  assert.deepEqual(w.store.cl_known_words.words, []);
  // 切り替えの最中に前の人の取得結果が書かれた場合
  w.store.cl_known_words = KNOWN_A;
  w.api.loadKnownWords(false);
  await w.settle();
  assert.ok(!w.api.view().cloud.includes('secretofa'));
});

test('ログアウトで cl_known_words を空にし、開いているタブからも外す', async () => {
  const w = await world(usedByA());
  await w.settle();
  w.api.loadKnownWords(false);
  await w.settle();
  assert.ok(w.api.view().cloud.includes('secretofa'), '前提: ログイン中は見える');
  await w.logout();
  await w.settle();
  assert.deepEqual(w.store.cl_known_words.words, []);
  assert.deepEqual(w.api.view().cloud, []);
});

test('救済処理（旗が未設定）でも A のローカル語が B へ送られない', async () => {
  const w = await world({ cl_last_user_id: 'A', cl_my_words: [{ word: 'alocal', savedAt: '2026-10-20', dramaTitle: 'Suits' }] });
  await w.login('B');
  await w.login('B'); // 2回目（last=B になった後の同期）
  await w.settle();
  assert.deepEqual(w.posts.filter((p) => p.table === 'my_words').map((p) => p.body[0].word), []);
  assert.deepEqual(w.store.cl_ledger_archive_A.cl_my_words.map((x) => x.word), ['alocal']);
});

test('守る: 同じ人の入り直しでは台帳も再会も控えも動かない', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.logout();
  await w.login('A');
  await w.settle();
  assert.deepEqual(w.store.cl_my_words, LEDGER_A);
  assert.deepEqual(w.store.cl_reunions, REUNIONS_A);
  assert.equal(Object.keys(w.store).filter((k) => k.startsWith('cl_ledger_archive_')).length, 0);
});

test('守る: まっさらな端末のゲストの語は、最初にログインした人が引き継ぐ', async () => {
  const w = await world();
  await w.save(word({ word: 'firstguest', dramaTitle: 'Dark', season: 1, episode: 1 }));
  assert.deepEqual(w.store.cl_sync_pending.map((x) => [x.word, x._clOwner]), [['firstguest', null]]);
  await w.login('A');
  await w.settle();
  assert.ok(w.posts.some((p) => p.as === 'A' && p.body[0].word === 'firstguest'));
  assert.deepEqual(w.store.cl_my_words.map((x) => x.word), ['firstguest']);
  assert.equal(w.store.cl_ledger_owner, 'A');
  assert.deepEqual(w.store.cl_sync_pending, []);
});

test('守る: 既存の利用者の更新では台帳を動かさず、印だけ付ける', async () => {
  const before = { cl_sb_session: sess('A'), cl_last_user_id: 'A', cl_sync_recover_v1: 1, cl_my_words: LEDGER_A, cl_reunions: REUNIONS_A, cl_known_words: KNOWN_A };
  const w = await world(before);
  await w.settle();
  assert.deepEqual(w.store.cl_my_words, LEDGER_A);
  assert.deepEqual(w.store.cl_reunions, REUNIONS_A);
  assert.deepEqual(w.store.cl_known_words, KNOWN_A);
  assert.equal(w.store.cl_ledger_owner, 'A');
  assert.equal(Object.keys(w.store).filter((k) => k.startsWith('cl_ledger_archive_')).length, 0);
  assert.equal(w.posts.length, 0);
});

test('更新前に A がログアウトしていて B が入ると、A の分を控えへ移す', async () => {
  const { cl_sb_session, ...rest } = { ...usedByA(), cl_ledger_owner: undefined };
  const w = await world(rest);
  await w.login('B');
  assert.deepEqual(w.store.cl_ledger_archive_A.cl_my_words, LEDGER_A);
  assert.deepEqual(w.store.cl_my_words, []);
  assert.equal(w.store.cl_ledger_owner, 'B');
});

test('失敗しても語が消えない: 入れ替えの書き込みが失敗→元のまま・送信を控える→次の契機で完了', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.logout();
  w.store.cl_sync_pending = [{ word: 'aqueued', _clOwner: 'A' }]; // A のログイン中は送られるので、抜けた後に積む
  w.faults.set = (o) => 'cl_ledger_owner' in o && o.cl_ledger_owner === 'B';
  w.posts.length = 0;
  await w.login('B');
  await w.settle();
  assert.deepEqual(w.store.cl_my_words, LEDGER_A, '台帳は元のまま');
  assert.deepEqual(w.store.cl_reunions, REUNIONS_A);
  assert.equal(w.store.cl_ledger_owner, 'A');
  assert.equal(w.posts.length, 0, '台帳が前の人のままの間は送らない');
  // 失敗中に B が保存しても、キューに残して送らない
  await w.save(word({ word: 'duringfail', dramaTitle: 'Dark', season: 1, episode: 1 }));
  await w.settle();
  assert.equal(w.posts.length, 0);
  assert.ok(w.store.cl_sync_pending.some((x) => x.word === 'duringfail' && x._clOwner === 'B'));
  // 復旧
  w.faults.set = null;
  await w.login('B');
  await w.settle();
  assert.equal(w.store.cl_ledger_owner, 'B');
  assert.ok(w.store.cl_ledger_archive_A.cl_my_words.some((x) => x.word === 'leverage'));
  assert.ok(w.store.cl_ledger_archive_A.cl_my_words.some((x) => x.word === 'betray'));
  assert.ok(w.posts.some((p) => p.as === 'B' && p.body[0].word === 'duringfail'));
  assert.ok(!w.posts.some((p) => p.as === 'B' && p.body[0].word === 'aqueued'), 'A の未送信語は B へ送らない');
  assert.ok(w.store.cl_sync_pending.some((x) => x.word === 'aqueued' && x._clOwner === 'A'));
});

test('失敗しても語が消えない: 戻した控えの片付けに失敗しても、次の入れ替えで正しく上書きされる', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.switchTo('B');
  await w.save(word({ word: 'bword', dramaTitle: 'Dark', season: 1, episode: 1 }));
  w.faults.remove = (k) => String(k).startsWith('cl_ledger_archive_');
  await w.switchTo('A');
  assert.deepEqual(w.store.cl_my_words, LEDGER_A);
  assert.ok(w.store.cl_ledger_archive_A, '片付けに失敗して残っている');
  w.faults.remove = null;
  await w.save(word({ word: 'anew', dramaTitle: 'Suits', season: 3, episode: 1 }));
  await w.switchTo('B');
  assert.ok(w.store.cl_ledger_archive_A.cl_my_words.some((x) => x.word === 'anew'), '古い控えで新しい語を失わない');
  assert.deepEqual(w.store.cl_my_words.map((x) => x.word), ['bword']);
});

test('同時に呼ばれても二重に入れ替えない（A の控えが空で潰れない）', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.logout();
  // ログインの同期と単語の送信がほぼ同時に走る
  const login = w.login('B');
  w.api.saveWord(word({ word: 'atsametime', dramaTitle: 'Dark', season: 1, episode: 1 }));
  await login;
  await w.settle();
  assert.equal(w.store.cl_ledger_owner, 'B');
  assert.ok(w.store.cl_ledger_archive_A.cl_my_words.some((x) => x.word === 'leverage'));
  assert.equal(w.store.cl_ledger_archive_B, undefined);
});

test('残る制限（第2段階は作らない・2026-11-05）: ログアウトしただけでは入れ替えず、未ログインの語は直前の人の語のまま', async () => {
  const w = await world(usedByA());
  await w.settle();
  await w.logout();
  assert.deepEqual(w.store.cl_my_words, LEDGER_A);
  await w.save(word({ word: 'whileout', dramaTitle: 'Dark', season: 1, episode: 1 }));
  await w.settle();
  assert.deepEqual(w.store.cl_sync_pending.map((x) => [x.word, x._clOwner]), [['whileout', 'A']]);
  w.posts.length = 0;
  await w.login('B');
  await w.settle();
  assert.equal(w.posts.filter((p) => p.table === 'my_words').length, 0, 'B へは送らない');
  await w.switchTo('A');
  assert.ok(w.posts.some((p) => p.as === 'A' && p.body[0].word === 'whileout'));
});
