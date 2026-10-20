// 2026-10-20 /decide D: リスト生成に使った字幕ファイル番号の記録と、手動追加の取り直しでの再利用。
//   - candidateEpisodeMatch: 選んだ候補が頼んだ話数のファイルか（exact / unknown / fallback）
//   - writeVocabRow: subtitle_file_id・episode_match を書く。列が無い DB（SQL 適用前）は列なしで再送
//   - readSubtitleSource / clearSubtitleFileId: 手動経路専用の読み・消し（列が無ければ null＝従来どおり検索）
//   - fetchSrtByFileId: 検索せずに記録したファイルを直接 DL。404 は status 付きで投げる（route が記録を消す）
// constants.js は import 時に env を読むので、鍵は dynamic import の前に設定する。
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.VOCAB_CACHE_VERSION = '2';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { writeVocabRow, readSubtitleSource, clearSubtitleFileId, _resetProvenanceFlagForTests } = await import('../lib/server/vocabCache.js');
const { candidateEpisodeMatch, fetchSrtByFileId } = await import('../lib/server/opensubtitles.js');
const { UpstreamError } = await import('../lib/server/constants.js');

const silentLog = { info() {}, warn() {}, error() {}, log() {} };
const WORDS = Array.from({ length: 25 }, (_, i) => ({ word: `word${i}`, source: 'drama', definition: 'x', example: `say word${i}`, tsSec: i, level: 'B2' }));

function fakeSupabase({ sourceColumns = true } = {}) {
  const db = new Map();
  const log = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    log.push({ method, path: u.pathname, search: u.search, body: init.body });
    if (u.pathname.endsWith('/catalog')) return new Response('', { status: 201 });
    if (u.pathname.endsWith('/vocab_cache')) {
      const key = decodeURIComponent((u.searchParams.get('cache_key') || '').replace(/^eq\./, ''));
      if (method === 'GET') {
        const sel = u.searchParams.get('select') || '';
        if (!sourceColumns && /subtitle_file_id/.test(sel)) return new Response(JSON.stringify({ code: '42703', message: 'column vocab_cache.subtitle_file_id does not exist' }), { status: 400 });
        const row = db.get(key);
        return new Response(JSON.stringify(row ? [row] : []), { status: 200 });
      }
      if (method === 'POST') {
        const rows = JSON.parse(init.body);
        if (!sourceColumns && rows.some((r) => 'subtitle_file_id' in r)) {
          return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'subtitle_file_id' column of 'vocab_cache' in the schema cache" }), { status: 400 });
        }
        for (const r of rows) if (!db.has(r.cache_key)) db.set(r.cache_key, r);
        return new Response('', { status: 201 });
      }
      if (method === 'PATCH') {
        const row = db.get(key);
        const fid = (u.searchParams.get('subtitle_file_id') || '').replace(/^eq\./, '');
        if (row && String(row.subtitle_file_id) === fid) Object.assign(row, JSON.parse(init.body));
        return new Response('', { status: 204 });
      }
    }
    return new Response('unexpected', { status: 500 });
  };
  return { db, log, fetchImpl };
}

test('D: candidateEpisodeMatch（話数一致・情報なし・別の話・映画）', () => {
  const c = (s, e) => ({ attributes: { feature_details: { season_number: s, episode_number: e } } });
  assert.equal(candidateEpisodeMatch(c(1, 3), false, 1, 3), 'exact');
  assert.equal(candidateEpisodeMatch(c('1', '3'), false, 1, 3), 'exact');
  assert.equal(candidateEpisodeMatch(c(1, 4), false, 1, 3), 'fallback');
  assert.equal(candidateEpisodeMatch(c(null, null), false, 1, 3), 'unknown');
  assert.equal(candidateEpisodeMatch({ attributes: {} }, false, 1, 3), 'unknown');
  assert.equal(candidateEpisodeMatch(c(9, 9), true, 0, 0), 'exact'); // 映画は話数を持たない
});

test('D: writeVocabRow はファイル番号と話数一致を書く（不正な値は書かない）', async () => {
  _resetProvenanceFlagForTests();
  const { db, fetchImpl } = fakeSupabase();
  await writeVocabRow({ tmdbId: 5, type: 'tv', season: 1, episode: 2, words: WORDS, subtitleFileId: 123456, episodeMatch: 'exact' }, { fetchImpl, log: silentLog });
  const row = db.get('v2:tmdb5:s1e2');
  assert.equal(row.subtitle_file_id, 123456);
  assert.equal(row.episode_match, 'exact');
  await writeVocabRow({ tmdbId: 6, type: 'tv', season: 1, episode: 1, words: WORDS, subtitleFileId: 7, episodeMatch: 'weird' }, { fetchImpl, log: silentLog });
  assert.equal(db.get('v2:tmdb6:s1e1').subtitle_file_id, 7);
  assert.ok(!('episode_match' in db.get('v2:tmdb6:s1e1')));
  await writeVocabRow({ tmdbId: 8, type: 'tv', season: 1, episode: 1, words: WORDS, subtitleFileId: null }, { fetchImpl, log: silentLog });
  assert.ok(!('subtitle_file_id' in db.get('v2:tmdb8:s1e1')));
});

test('D: 列が無い DB（SQL 適用前）では列なしで再送し、寄与の記録（contributed_by）は残す', async () => {
  _resetProvenanceFlagForTests();
  const { db, log, fetchImpl } = fakeSupabase({ sourceColumns: false });
  const r = await writeVocabRow(
    { tmdbId: 9, type: 'tv', season: 1, episode: 1, words: WORDS, subtitleFileId: 42, episodeMatch: 'exact', contributedBy: 'u:abcdef0123456789' },
    { fetchImpl, log: silentLog }
  );
  assert.equal(r.written, true);
  const row = db.get('v2:tmdb9:s1e1');
  assert.ok(!('subtitle_file_id' in row));
  assert.equal(row.contributed_by, 'u:abcdef0123456789');
  assert.equal(log.filter((l) => l.method === 'POST' && l.path.endsWith('/vocab_cache')).length, 2);
});

test('D: readSubtitleSource は記録を返し、列なし・記録なしは null（従来どおり検索）', async () => {
  const { db, fetchImpl } = fakeSupabase();
  db.set('v2:tmdb1:s1e1', { cache_key: 'v2:tmdb1:s1e1', subtitle_file_id: 99, episode_match: 'unknown' });
  db.set('v2:tmdb2:s1e1', { cache_key: 'v2:tmdb2:s1e1', subtitle_file_id: null });
  assert.deepEqual(await readSubtitleSource('v2:tmdb1:s1e1', { fetchImpl }), { fileId: 99, episodeMatch: 'unknown' });
  assert.equal(await readSubtitleSource('v2:tmdb2:s1e1', { fetchImpl }), null);
  assert.equal(await readSubtitleSource('v2:tmdb3:s1e1', { fetchImpl }), null);
  const noCols = fakeSupabase({ sourceColumns: false });
  noCols.db.set('v2:tmdb1:s1e1', { cache_key: 'v2:tmdb1:s1e1' });
  assert.equal(await readSubtitleSource('v2:tmdb1:s1e1', { fetchImpl: noCols.fetchImpl }), null);
});

test('D: clearSubtitleFileId は同じ番号の時だけ消す', async () => {
  const { db, fetchImpl } = fakeSupabase();
  db.set('v2:tmdb1:s1e1', { cache_key: 'v2:tmdb1:s1e1', subtitle_file_id: 99, episode_match: 'exact' });
  await clearSubtitleFileId('v2:tmdb1:s1e1', 100, { fetchImpl, log: silentLog });
  assert.equal(db.get('v2:tmdb1:s1e1').subtitle_file_id, 99); // 別の番号＝触らない
  await clearSubtitleFileId('v2:tmdb1:s1e1', 99, { fetchImpl, log: silentLog });
  assert.equal(db.get('v2:tmdb1:s1e1').subtitle_file_id, null);
  assert.equal(db.get('v2:tmdb1:s1e1').episode_match, null);
});

const GOOD_SRT = Array.from({ length: 30 }, (_, i) => `${i + 1}\n00:00:${String(10 + i).padStart(2, '0')},000 --> 00:00:${String(11 + i).padStart(2, '0')},000\nThis is a perfectly ordinary line of dialogue number ${i}.\n`).join('\n');

function fakeOs({ downloadStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body });
    if (u.endsWith('/download')) {
      if (downloadStatus !== 200) return new Response(JSON.stringify({ message: 'not found' }), { status: downloadStatus });
      return new Response(JSON.stringify({ link: 'https://dl.example/sub.srt', remaining: 50 }), { status: 200 });
    }
    if (u === 'https://dl.example/sub.srt') return new Response(GOOD_SRT, { status: 200 });
    if (u.includes('/subtitle_raw_cache')) return new Response('', { status: 201 });
    if (u.includes('/subtitles?')) throw new Error('検索は呼ばれてはいけない');
    return new Response('unexpected', { status: 500 });
  };
  return { calls, fetchImpl };
}
const OS_ENV = { OPENSUBTITLES_API_KEY: 'k' };

test('D: fetchSrtByFileId は検索せずに記録したファイルを DL し、raw cache に同じ番号で書く', async () => {
  const { calls, fetchImpl } = fakeOs();
  const sub = await fetchSrtByFileId({ tmdbId: 37680, type: 'tv', season: 1, episode: 1, fileId: 555 }, { env: OS_ENV, fetchImpl, log: silentLog });
  assert.equal(sub.fileId, 555);
  assert.equal(sub.via, 'file_id');
  assert.equal(JSON.parse(calls.find((c) => c.url.endsWith('/download')).body).file_id, 555);
  const rawWrite = calls.find((c) => c.url.includes('/subtitle_raw_cache'));
  assert.equal(JSON.parse(rawWrite.body)[0].provider, 'opensubtitles:555');
  assert.ok(!calls.some((c) => c.url.includes('/subtitles?')));
});

test('D: ファイルが OS から消えていたら status 404 付きで投げる（route が記録を消して1回だけ検索に戻る）', async () => {
  const { fetchImpl } = fakeOs({ downloadStatus: 404 });
  await assert.rejects(
    fetchSrtByFileId({ tmdbId: 37680, type: 'tv', season: 1, episode: 1, fileId: 555 }, { env: OS_ENV, fetchImpl, log: silentLog }),
    (err) => err instanceof UpstreamError && err.reason === 'os_download' && err.status === 404
  );
});

const { refetchSubtitleForManual } = await import('../lib/server/manualRefetch.js');
function deps({ src = null, byFileId, search } = {}) {
  const calls = { byFileId: 0, search: 0, cleared: [] };
  return {
    calls,
    d: {
      log: silentLog,
      readSource: async () => src,
      clearSource: async (k, f) => calls.cleared.push([k, f]),
      byFileId: async (a) => {
        calls.byFileId++;
        return byFileId(a);
      },
      search: async () => {
        calls.search++;
        return search ? search() : { raw: 'searched', fileId: 1, via: 'opensubtitles' };
      },
    },
  };
}
const EP = { cacheKey: 'v2:tmdb1:s1e1', tmdbId: 1, type: 'tv', season: 1, episode: 1 };

test('D: 記録があれば検索せずに同じファイルで取り直す', async () => {
  const { calls, d } = deps({ src: { fileId: 77, episodeMatch: 'exact' }, byFileId: async (a) => ({ raw: 'r', fileId: a.fileId, via: 'file_id' }) });
  const sub = await refetchSubtitleForManual(EP, d);
  assert.equal(sub.fileId, 77);
  assert.deepEqual([calls.byFileId, calls.search], [1, 0]);
});

test('D: ファイルが消えていた（404/410）時だけ記録を消して1回だけ検索に戻る', async () => {
  for (const status of [404, 410]) {
    const { calls, d } = deps({ src: { fileId: 77, episodeMatch: 'unknown' }, byFileId: async () => { throw new UpstreamError('os_download', { status }); } });
    const sub = await refetchSubtitleForManual(EP, d);
    assert.equal(sub.raw, 'searched');
    assert.deepEqual([calls.byFileId, calls.search], [1, 1]);
    assert.deepEqual(calls.cleared, [['v2:tmdb1:s1e1', 77]]);
  }
});

test('D: 一時障害（5xx・os_quota・通信）は記録を消さず、検索にも戻らない', async () => {
  for (const err of [new UpstreamError('os_download', { status: 503 }), new UpstreamError('os_quota', { status: 0 }), new UpstreamError('os_download', { cause: new Error('timeout') })]) {
    const { calls, d } = deps({ src: { fileId: 77, episodeMatch: 'exact' }, byFileId: async () => { throw err; } });
    await assert.rejects(refetchSubtitleForManual(EP, d), (e) => e === err);
    assert.deepEqual([calls.search, calls.cleared.length], [0, 0]);
  }
});

test('D: 記録なし・別の話数の記録・使えないファイルは従来どおり検索', async () => {
  for (const [src, byFileId] of [
    [null, async () => assert.fail('呼ばれない')],
    [{ fileId: 77, episodeMatch: 'fallback' }, async () => assert.fail('fallback の記録は使わない')],
    [{ fileId: 77, episodeMatch: 'exact' }, async () => null], // 歌詞字幕・短すぎ
  ]) {
    const { calls, d } = deps({ src, byFileId });
    const sub = await refetchSubtitleForManual(EP, d);
    assert.equal(sub.raw, 'searched');
    assert.equal(calls.search, 1);
  }
});
