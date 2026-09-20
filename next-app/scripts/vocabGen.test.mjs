// lib/server/vocabGen.js（品質ゲート・generateEpisodeVocab の deps 注入）と lib/server/vocabCache.js writeVocabRow
// （catalog の ignore-duplicates・PGRST204 フォールバック）の単体テスト。Supabase は fetch モックの簡易 DB で代替。
// constants.js は import 時に env を読むので、service_role 鍵は dynamic import の前に設定する。
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.VOCAB_CACHE_VERSION = '2';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { qualityGate, generateEpisodeVocab, clampVocabCount, SUBTITLE_PROVIDER } = await import('../lib/server/vocabGen.js');
const { writeVocabRow, contributedByOf, vocabCacheKey, normalizeEpisode, _resetProvenanceFlagForTests } = await import('../lib/server/vocabCache.js');
const { UpstreamError, HAIKU_MODEL } = await import('../lib/server/constants.js');

const silentLog = { info() {}, warn() {}, log() {}, error() {} };

const WORDS = [
  'subpoena', 'deposition', 'litigation', 'injunction', 'liability', 'negotiate', 'acquisition', 'leverage', 'scrutiny',
  'tenacity', 'paramount', 'meticulous', 'ambivalent', 'prognosis', 'malignant', 'diagnosis', 'liquidity', 'perfunctory',
  'recalcitrant', 'ineffable', 'comprehensive', 'inevitable', 'deliberately', 'acknowledge', 'schedule',
];
const sentenceOf = (w) => `We talked about the ${w} for a while today.`;

// startSec から stepSec 刻みで WORDS の文を並べた SRT（合計文字数は MIN_SRT_CHARS=200 を十分に超える）。
function srtOf(startSec, stepSec) {
  const ts = (sec) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s},000`;
  };
  return WORDS.map((w, i) => {
    const sec = startSec + i * stepSec;
    return `${i + 1}\n${ts(sec)} --> ${ts(sec + 2)}\n${sentenceOf(w)}\n`;
  }).join('\n');
}
const W = (w, e, extra = {}) => ({ w, l: 'C1', p: '名詞', d: `${w} の意味`, e, t: 'core', c: '', ...extra });
const llmReply = (dramaList = WORDS, plusList = ['idiosyncratic', 'ubiquitous']) =>
  JSON.stringify({
    drama: dramaList.map((w) => W(w, sentenceOf(w))),
    plus: plusList.map((w) => W(w, `Everything about ${w} is ${w}.`)),
  });

test('clampVocabCount は 20〜60 に丸め、不正は既定 40', () => {
  assert.equal(clampVocabCount(undefined), 40);
  assert.equal(clampVocabCount('abc'), 40);
  assert.equal(clampVocabCount(5), 20);
  assert.equal(clampVocabCount(999), 60);
  assert.equal(clampVocabCount(33.4), 33);
});

test('qualityGate: definition 無し・例文に語を含まない drama を落とし、clean≥20 かつ drama≥5 で合格', () => {
  const good = WORDS.map((w) => ({ word: w, source: 'drama', definition: 'x', example: sentenceOf(w), tsSec: 10 }));
  const g = qualityGate(good, '');
  assert.equal(g.ok, true);
  assert.equal(g.reason, 'ok');
  assert.equal(g.clean.length, 25);
  assert.equal(g.dramaCount, 25);
  assert.ok(g.storeWords.every((w) => !('example_ja_ok' in w)));

  const bad = [
    ...good.slice(0, 15),
    { word: 'nodef', source: 'drama', definition: '', example: 'nodef here' }, // definition 無し
    { word: 'mismatch', source: 'drama', definition: 'x', example: 'the example lacks the word' }, // 語を含まない
    ...['p1', 'p2', 'p3', 'p4'].map((w) => ({ word: w, source: 'plus', definition: 'x', example: 'any' })), // plus は許容
  ];
  const b = qualityGate(bad, '');
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'gate');
  assert.equal(b.clean.length, 19);
});

test('qualityGate: 語数は足りても📍が偏っていれば coverage で落ちる', () => {
  const raw = srtOf(1800, 60); // 30:00 から 1 分刻み → 総尺 ≈ 54:02
  const words = WORDS.map((w, i) => ({ word: w, source: 'drama', definition: 'x', example: sentenceOf(w), tsSec: 1800 + i * 60 }));
  const g = qualityGate(words, raw);
  assert.equal(g.ok, false);
  assert.equal(g.reason, 'coverage');
});

test('generateEpisodeVocab: TMDB 解決値で生成し、drama に📍・plus は null・raw を返さない・contributed=true', async () => {
  const raw = srtOf(5, 10);
  const seen = {};
  const result = await generateEpisodeVocab(
    { tmdbId: 1234, type: 'tv', season: 1, episode: 2, vocabCount: 40, deadlineAt: Date.now() + 200_000 },
    {
      log: silentLog,
      resolveTitles: async (a) => {
        seen.resolve = a;
        return { englishTitle: 'Suits', displayTitle: 'スーツ', posterPath: '/p.jpg' };
      },
      fetchSrt: async (a) => {
        seen.fetch = a;
        return { raw, fileId: 777, via: 'raw_cache' };
      },
      callLlm: async (prompt, maxTokens, o) => {
        seen.prompt = prompt;
        seen.llmOpts = o;
        return llmReply();
      },
    }
  );
  assert.deepEqual(seen.resolve, { tmdbId: 1234, type: 'tv' });
  assert.deepEqual(seen.fetch, { tmdbId: 1234, type: 'tv', season: 1, episode: 2 });
  assert.ok(seen.prompt.includes('「Suits」Season 1 Episode 2')); // 作品名は TMDB 解決値
  assert.equal(seen.llmOpts.nChunks, 1);
  assert.equal(result.nosub, false);
  assert.equal(result.contributed, true);
  assert.equal(result.reason, 'ok');
  assert.equal(result.cacheKey, 'v2:tmdb1234:s1e2');
  assert.equal(result.englishTitle, 'Suits');
  assert.equal(result.displayTitle, 'スーツ');
  assert.equal(result.provider, SUBTITLE_PROVIDER);
  assert.equal(result.model, HAIKU_MODEL);
  assert.equal(result.fileId, 777);
  assert.equal(result.subtitleVia, 'raw_cache');
  assert.equal(result.chunks, 1);
  assert.ok(!('raw' in result) && !('subtitleText' in result) && !('parsed' in result)); // 字幕本文は返さない
  const byWord = Object.fromEntries(result.words.map((w) => [w.word, w]));
  assert.equal(byWord.subpoena.source, 'drama');
  assert.equal(byWord.subpoena.tsSec, 5);
  assert.equal(byWord.subpoena.tsLabel, '0:05');
  assert.equal(byWord.schedule.tsSec, 5 + 24 * 10);
  assert.equal(byWord.idiosyncratic.source, 'plus');
  assert.equal(byWord.idiosyncratic.tsSec, null);
  assert.equal(byWord.idiosyncratic.tsLabel, null);
  assert.ok(result.words.every((w) => !('example_ja_ok' in w)));
  assert.equal(result.storeWords.length, 27);
  assert.deepEqual(result.coverage, { min: 'C1', max: 'C1' });
});

test('generateEpisodeVocab: 字幕なしは { nosub:true }・短すぎる raw も nosub', async () => {
  const base = { tmdbId: 1, type: 'movie', season: 1, episode: 1 };
  const deps = { log: silentLog, resolveTitles: async () => ({ englishTitle: 'X', displayTitle: 'X' }), callLlm: async () => llmReply() };
  const a = await generateEpisodeVocab(base, { ...deps, fetchSrt: async () => null });
  assert.deepEqual(a, { nosub: true, cacheKey: 'v2:tmdb1:s0e0' }); // 映画は s0e0 に正規化
  const b = await generateEpisodeVocab(base, { ...deps, fetchSrt: async () => ({ raw: '1\n00:00:01,000 --> 00:00:02,000\nHi.\n', fileId: 1, via: 'opensubtitles' }) });
  assert.equal(b.nosub, true);
});

test('generateEpisodeVocab: ゲート不通過は words を返しつつ contributed=false', async () => {
  const raw = srtOf(5, 10);
  const result = await generateEpisodeVocab(
    { tmdbId: 1, type: 'tv', season: 1, episode: 1 },
    {
      log: silentLog,
      resolveTitles: async () => ({ englishTitle: 'Suits', displayTitle: 'スーツ' }),
      fetchSrt: async () => ({ raw, fileId: 1, via: 'opensubtitles' }),
      callLlm: async () => llmReply(WORDS.slice(0, 6), ['ubiquitous']), // clean 7 < 20
    }
  );
  assert.equal(result.nosub, false);
  assert.equal(result.contributed, false);
  assert.equal(result.reason, 'gate');
  assert.equal(result.words.length, 7);
});

test('generateEpisodeVocab: UpstreamError は素通し、その他の生成失敗は UpstreamError(generation)、TMDB 失敗は tmdb', async () => {
  const raw = srtOf(5, 10);
  const deps = {
    log: silentLog,
    resolveTitles: async () => ({ englishTitle: 'Suits', displayTitle: 'スーツ' }),
    fetchSrt: async () => ({ raw, fileId: 1, via: 'opensubtitles' }),
  };
  const input = { tmdbId: 1, type: 'tv', season: 1, episode: 1 };
  await assert.rejects(
    () => generateEpisodeVocab(input, { ...deps, callLlm: async () => { throw new UpstreamError('timeout'); } }),
    (e) => e instanceof UpstreamError && e.reason === 'timeout'
  );
  await assert.rejects(
    () => generateEpisodeVocab(input, { ...deps, callLlm: async () => 'not json at all' }),
    (e) => e instanceof UpstreamError && e.reason === 'generation'
  );
  await assert.rejects(
    () => generateEpisodeVocab(input, { ...deps, resolveTitles: async () => { throw new UpstreamError('tmdb', { status: 404 }); } }),
    (e) => e instanceof UpstreamError && e.reason === 'tmdb' && e.status === 404
  );
  await assert.rejects(() => generateEpisodeVocab({ ...input, tmdbId: 'x' }, deps), TypeError);
});

// ── vocabCache.writeVocabRow: 簡易 DB で PostgREST の ignore-duplicates / PGRST204 を再現 ──
function fakeSupabase({ provenanceColumns = true } = {}) {
  const db = { catalog: new Map(), vocab_cache: new Map() };
  const log = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const prefer = init.headers?.Prefer || '';
    log.push({ method, path: u.pathname, search: u.search, prefer });
    if (method === 'GET' && u.pathname.endsWith('/vocab_cache')) {
      const key = decodeURIComponent((u.searchParams.get('cache_key') || '').replace(/^eq\./, ''));
      const row = db.vocab_cache.get(key);
      return new Response(JSON.stringify(row ? [{ cache_key: key }] : []), { status: 200 });
    }
    if (method === 'POST' && u.pathname.endsWith('/catalog')) {
      assert.match(prefer, /resolution=ignore-duplicates/); // A2: merge-duplicates 禁止
      for (const r of JSON.parse(init.body)) if (!db.catalog.has(r.tmdb_id)) db.catalog.set(r.tmdb_id, r);
      return new Response('', { status: 201 });
    }
    if (method === 'POST' && u.pathname.endsWith('/vocab_cache')) {
      assert.match(prefer, /resolution=ignore-duplicates/);
      const rows = JSON.parse(init.body);
      if (!provenanceColumns && rows.some((r) => 'contributed_by' in r)) {
        return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'contributed_by' column" }), { status: 400 });
      }
      for (const r of rows) if (!db.vocab_cache.has(r.cache_key)) db.vocab_cache.set(r.cache_key, r);
      return new Response('', { status: 201 });
    }
    return new Response('unexpected', { status: 500 });
  };
  return { db, log, fetchImpl };
}
const goodWords = WORDS.map((w) => ({ word: w, source: 'drama', definition: 'x', example: sentenceOf(w), tsSec: 10, level: 'B2', example_ja_ok: true }));

test('writeVocabRow: 既に enabled:true の catalog 行は false に戻らない（ignore-duplicates）・vocab 行は1回だけ書ける', async () => {
  _resetProvenanceFlagForTests();
  const { db, fetchImpl } = fakeSupabase();
  db.catalog.set(99, { tmdb_id: 99, display_title: 'Seeded', type: 'tv', enabled: true });
  const input = { tmdbId: 99, type: 'tv', season: 1, episode: 1, displayTitle: 'スーツ', words: goodWords, contributedBy: 'u:abcdef0123456789' };
  const r1 = await writeVocabRow(input, { fetchImpl, log: silentLog });
  assert.equal(r1.written, true);
  assert.equal(r1.count, 25);
  assert.equal(r1.cacheKey, 'v2:tmdb99:s1e1');
  assert.equal(db.catalog.get(99).enabled, true); // ★既存行は触らない
  assert.equal(db.catalog.get(99).display_title, 'Seeded');
  const row = db.vocab_cache.get('v2:tmdb99:s1e1');
  assert.equal(row.contributed_by, 'u:abcdef0123456789');
  assert.equal(row.subtitle_provider, 'opensubtitles(server)');
  assert.equal(row.model, HAIKU_MODEL);
  assert.equal(row.cache_version, 2);
  assert.ok(row.words.every((w) => !('example_ja_ok' in w)));
  assert.deepEqual([row.coverage_min, row.coverage_max], ['B2', 'B2']);
  const r2 = await writeVocabRow(input, { fetchImpl, log: silentLog });
  assert.deepEqual(r2, { skipped: 'exists', cacheKey: 'v2:tmdb99:s1e1' });
});

test('writeVocabRow: 新規作品は catalog に enabled:false で登録される', async () => {
  _resetProvenanceFlagForTests();
  const { db, fetchImpl } = fakeSupabase();
  await writeVocabRow({ tmdbId: 5, type: 'movie', season: 1, episode: 1, displayTitle: 'M', words: goodWords }, { fetchImpl, log: silentLog });
  assert.equal(db.catalog.get(5).enabled, false);
  assert.equal(db.catalog.get(5).type, 'movie');
  assert.ok(db.vocab_cache.has('v2:tmdb5:s0e0'));
  assert.ok(!('contributed_by' in db.vocab_cache.get('v2:tmdb5:s0e0'))); // contributedBy 無し＝列を書かない
});

test('writeVocabRow: contributed_by 列が無い DB では PGRST204 を検知して列なしで再送（以後は付けない）', async () => {
  _resetProvenanceFlagForTests();
  const { db, log, fetchImpl } = fakeSupabase({ provenanceColumns: false });
  const r = await writeVocabRow({ tmdbId: 7, type: 'tv', season: 2, episode: 3, words: goodWords, contributedBy: 'ip:0123456789abcdef' }, { fetchImpl, log: silentLog });
  assert.equal(r.written, true);
  assert.equal(log.filter((l) => l.method === 'POST' && l.path.endsWith('/vocab_cache')).length, 2);
  assert.ok(!('contributed_by' in db.vocab_cache.get('v2:tmdb7:s2e3')));
  const r2 = await writeVocabRow({ tmdbId: 8, type: 'tv', season: 1, episode: 1, words: goodWords, contributedBy: 'ip:0123456789abcdef' }, { fetchImpl, log: silentLog });
  assert.equal(r2.written, true);
  assert.equal(log.filter((l) => l.method === 'POST' && l.path.endsWith('/vocab_cache')).length, 3); // 2回目以降は1発
});

test('writeVocabRow: 不正入力は skipped bad-input', async () => {
  const { fetchImpl } = fakeSupabase();
  assert.deepEqual(await writeVocabRow({ tmdbId: 0, words: goodWords }, { fetchImpl, log: silentLog }), { skipped: 'bad-input', cacheKey: null });
  assert.equal((await writeVocabRow({ tmdbId: 1, type: 'tv', words: [] }, { fetchImpl, log: silentLog })).skipped, 'bad-input');
});

test('contributedByOf / vocabCacheKey / normalizeEpisode', () => {
  assert.equal(contributedByOf({ uid: 'user-1' }, {}), null); // 鍵が無ければ列を書かない
  const a = contributedByOf({ uid: 'user-1' }, { CL_HASH_PEPPER: 'pepper' });
  const b = contributedByOf({ uid: 'user-1' }, { CL_SEED_SECRET: 'seed' });
  const c = contributedByOf({ ip: '203.0.113.7' }, { CL_HASH_PEPPER: 'pepper' });
  assert.match(a, /^u:[0-9a-f]{16}$/);
  assert.match(c, /^ip:[0-9a-f]{16}$/);
  assert.notEqual(a, b); // 鍵が違えばハッシュも違う
  assert.equal(contributedByOf({ uid: 'user-1' }, { CL_HASH_PEPPER: 'pepper', CL_SEED_SECRET: 'seed' }), a); // PEPPER 優先
  assert.equal(vocabCacheKey(12, 'movie', 3, 4), 'v2:tmdb12:s0e0');
  assert.equal(vocabCacheKey(12, 'tv', '3', '4'), 'v2:tmdb12:s3e4');
  assert.equal(vocabCacheKey('abc', 'tv', 1, 1), null);
  assert.deepEqual(normalizeEpisode('tv', undefined, null), { type: 'tv', season: 1, episode: 1 });
});
