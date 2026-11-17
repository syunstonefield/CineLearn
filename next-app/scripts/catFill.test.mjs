// 前に学んだ語にカテゴリを埋める（lib/catFill.js・2026-11-17）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillHistoryCats, pickTargets, requestFor, entryMark, tableMark, RETRY_DAYS, TABLE_URL } from '../lib/catFill.js';
import { catFields, catOf } from '../lib/relCategories.js';

const ep = (id, tmdbId, s, e, words, extra = {}) => ({ id, drama: { title: `作品${tmdbId}`, ...(tmdbId ? { tmdbId } : {}), ...extra }, season: s, episode: e, words });

function setup(history, replies, table = null) {
  let hist = JSON.parse(JSON.stringify(history));
  let tried = {};
  const sent = [];
  const saved = [];
  const tableHits = [];
  const deps = {
    loadHistory: () => JSON.parse(JSON.stringify(hist)),
    updateHistoryWords: (id, words) => {
      saved.push(id);
      hist = hist.map((h) => (h.id === id ? { ...h, words } : h));
    },
    readTried: () => tried,
    writeTried: (o) => (tried = { ...o }),
    fetchImpl: async (url, opts) => {
      if (url === TABLE_URL) {
        tableHits.push(url);
        return table ? { ok: true, json: async () => table } : { ok: false, json: async () => ({}) };
      }
      const body = JSON.parse(opts.body);
      sent.push({ url, body });
      const r = replies(body);
      if (r === 'throw') throw new Error('offline');
      if (r === 500) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => r };
    },
  };
  return { deps, sent, saved, tableHits, hist: () => hist, tried: () => tried, setTried: (o) => (tried = o) };
}

test('値のない話だけ・番号だけを送り、返った値を写して保存する', async () => {
  const s = setup(
    [ep('a', 10, 1, 2, [{ word: 'Furious' }, { word: 'kept', ...catFields('time.now') }]), ep('b', 11, 1, 1, [{ word: 'done', ...catFields('other') }])],
    () => ({ hit: true, cats: [{ w: 'furious', cat: 'emotion', sub: 'anger' }, { w: 'kept', cat: 'emotion', sub: 'joy' }] })
  );
  const n = await fillHistoryCats(s.deps);
  assert.equal(n, 1);
  assert.equal(s.sent.length, 1); // b は全部付いている＝聞かない
  assert.deepEqual(s.sent[0], { url: '/api/vocab-cats', body: { tmdbId: 10, type: 'tv', season: 1, episode: 2 } });
  const a = s.hist().find((h) => h.id === 'a');
  assert.deepEqual(catOf(a.words[0]), { cat: 'emotion', sub: 'anger' });
  assert.equal(a.words[1].cat, 'time'); // もう値がある語はさわらない
  assert.deepEqual(s.tried(), {}); // 埋め切れた話は覚えない
});

test('配信オフ・キャッシュに無い話は覚えて聞き直さない／通信の失敗は覚えない', async () => {
  const s = setup([ep('a', 10, 1, 1, [{ word: 'x' }]), ep('b', 11, 1, 1, [{ word: 'y' }])], (b) => (b.tmdbId === 10 ? { blocked: true } : { miss: true }));
  assert.equal(await fillHistoryCats(s.deps), 0);
  assert.ok(Object.keys(s.tried()).includes(entryMark({ tmdbId: 10, type: 'tv', season: 1, episode: 1 })));
  s.sent.length = 0;
  await fillHistoryCats(s.deps);
  assert.equal(s.sent.length, 0);

  const f = setup([ep('a', 10, 1, 1, [{ word: 'x' }]), ep('b', 11, 1, 1, [{ word: 'y' }])], () => 'throw');
  assert.equal(await fillHistoryCats(f.deps), 0);
  assert.equal(f.sent.length, 1); // 通信できなければそこでやめる
  assert.deepEqual(f.tried(), {});
  const g = setup([ep('a', 10, 1, 1, [{ word: 'x' }])], () => 500);
  await fillHistoryCats(g.deps);
  assert.deepEqual(g.tried(), {});
});

test('覚えたしるしは日がたつと聞き直す', () => {
  const h = [ep('a', 10, 1, 1, [{ word: 'x' }])];
  const mark = entryMark({ tmdbId: 10, type: 'tv', season: 1, episode: 1 });
  const now = Date.now();
  assert.equal(pickTargets(h, { [mark]: now - 864e5 }, {}, now).length, 0);
  assert.equal(pickTargets(h, { [mark]: now - (RETRY_DAYS + 1) * 864e5 }, {}, now).length, 1);
});

test('送る中身: tmdbId の無い古い話は作品一覧から・映画は 0/0・分からなければ送らない', () => {
  assert.deepEqual(requestFor(ep('a', null, 1, 3, []), { tmdbIdOf: (t) => (t === '作品null' ? 77 : null) }), { tmdbId: 77, type: 'tv', season: 1, episode: 3 });
  assert.deepEqual(requestFor(ep('m', 5, 1, 1, [], { type: 'movie' }), { isMovie: (t, ty) => ty === 'movie' }), { tmdbId: 5, type: 'movie', season: 0, episode: 0 });
  assert.equal(requestFor(ep('z', null, 1, 1, [])), null);
});

test('1回の起動で聞く話の数に上限がある', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ep(`e${i}`, 100 + i, 1, 1, [{ word: 'w' }]));
  const s = setup(many, () => ({ hit: true, cats: [] }));
  await fillHistoryCats({ ...s.deps, max: 2 });
  assert.equal(s.sent.length, 2);
});

const TABLE = { catv: 1, words: { furious: 'emotion.anger', odd: 'other', lawyer: 'society.law' } };

test('保険の表: 作品の番号が分からない話・窓口で埋め切れなかった話の残りの語を埋める（窓口の値が先）', async () => {
  const s = setup(
    [ep('noid', null, 1, 1, [{ word: 'Furious' }, { word: 'nothere' }]), ep('a', 10, 1, 1, [{ word: 'lawyer' }, { word: 'furious' }])],
    () => ({ hit: true, cats: [{ w: 'furious', cat: 'emotion', sub: 'joy' }] }),
    TABLE
  );
  const n = await fillHistoryCats(s.deps);
  assert.equal(n, 3); // noid の furious（表）・a の furious（窓口）と lawyer（表）
  assert.equal(s.sent.length, 1); // 番号の分かる話だけ窓口に聞く
  const noid = s.hist().find((h) => h.id === 'noid');
  assert.deepEqual(catOf(noid.words[0]), { cat: 'emotion', sub: 'anger' });
  assert.equal(noid.words[1].cat, undefined); // 表に無い語はそのまま
  const a = s.hist().find((h) => h.id === 'a');
  assert.deepEqual(catOf(a.words[1]), { cat: 'emotion', sub: 'joy' }); // 窓口の値（場面の意味）が先
  assert.deepEqual(catOf(a.words[0]), { cat: 'society', sub: 'law' }); // 窓口に無かった語は表で
  assert.ok(tableMark('noid') in s.tried());
  s.tableHits.length = 0;
  await fillHistoryCats(s.deps);
  assert.equal(s.tableHits.length, 0); // しばらくは表を引き直さない
});

test('保険の表: 窓口をまだ聞けていない話（通信の失敗）は表で先に埋めない', async () => {
  const s = setup([ep('a', 10, 1, 1, [{ word: 'furious' }])], () => 'throw', TABLE);
  await fillHistoryCats(s.deps);
  assert.equal(s.hist()[0].words[0].cat, undefined);
  assert.equal(s.tableHits.length, 0);
});

test('前の版のしるし（配信オフで聞き直さない印）は捨てて、すぐ聞き直す', async () => {
  const s = setup([ep('a', 10, 1, 1, [{ word: 'x' }])], () => ({ hit: true, cats: [{ w: 'x', cat: 'time', sub: 'now' }] }));
  s.setTried({ ['1:10:tv:1:1']: Date.now() });
  await fillHistoryCats(s.deps);
  assert.equal(s.sent.length, 1);
  assert.equal(s.hist()[0].words[0].cat, 'time');
});
