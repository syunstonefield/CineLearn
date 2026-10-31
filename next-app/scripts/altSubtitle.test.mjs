// 2026-10-31: アンカー行（画面の字幕行）が今の字幕ファイルに無い時、OS の別候補を試して差し替える。
//   - anchorPresentInSrt: 同じ文が SRT に在るか（語は問わない・1語アンカーは「在る」扱い＝取りに行かせない）
//   - fetchEpisodeSrtAlternative: 今のファイルを除いた候補を上位から最大2件 DL し、accept を満たす最初の1件を
//     raw cache に書いて返す。満たす候補が無ければ raw cache は触らず null。歌詞字幕・短すぎは除外。
// 背景: Suits S1E1 の 31:50〜32:01 の台詞が OS 字幕に無く、4語が no_match になった（本番で確定）。
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { anchorPresentInSrt } = await import('../lib/subtitles.js');
const { fetchEpisodeSrtAlternative } = await import('../lib/server/opensubtitles.js');

const silentLog = { info() {}, warn() {}, error() {}, log() {} };
const OS_ENV = { OPENSUBTITLES_API_KEY: 'k' };

const srtOf = (lines) =>
  lines.map((t, i) => `${i + 1}\n00:${String(Math.floor(i / 6)).padStart(2, '0')}:${String((i * 10) % 60).padStart(2, '0')},000 --> 00:${String(Math.floor(i / 6)).padStart(2, '0')}:${String((i * 10) % 60 + 5).padStart(2, '0')},000\n${t}\n`).join('\n');
const FILLER = Array.from({ length: 30 }, (_, i) => `This is a perfectly ordinary line of dialogue number ${i} for padding.`);
// 配信版の 31:50〜32:01 相当の台詞を含むファイル／含まないファイル
const SCENE = ['I like the symmetry of it, mergers and acquisitions, all anchored to the same deal.'];
const SRT_WITH = srtOf([...FILLER, ...SCENE]);
const SRT_WITHOUT = srtOf(FILLER);
const ANCHOR = 'I LIKE THE SYMMETRY OF IT, MERGERS AND ACQUISITIONS,';

test('anchorPresentInSrt: 同じ文が在れば true・無ければ false・1語アンカーは true', () => {
  assert.equal(anchorPresentInSrt(SRT_WITH, ANCHOR), true);
  assert.equal(anchorPresentInSrt(SRT_WITHOUT, ANCHOR), false);
  assert.equal(anchorPresentInSrt(SRT_WITHOUT, 'symmetry'), true);
  assert.equal(anchorPresentInSrt('', ANCHOR), false);
  assert.equal(anchorPresentInSrt(SRT_WITH, ''), false);
});

function fakeOs({ files }) {
  // files: [{ id, srt, s, e }]  検索結果の順＝候補の順
  const calls = { search: 0, download: [], rawWrites: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/subtitles?')) {
      calls.search++;
      return new Response(JSON.stringify({ data: files.map((f) => ({ attributes: { feature_details: { season_number: f.s ?? 1, episode_number: f.e ?? 1 }, files: [{ file_id: f.id }], download_count: 100 } })) }), { status: 200 });
    }
    if (u.endsWith('/download')) {
      const fid = JSON.parse(init.body).file_id;
      calls.download.push(fid);
      return new Response(JSON.stringify({ link: `https://dl.example/${fid}.srt`, remaining: 50 }), { status: 200 });
    }
    const m = /^https:\/\/dl\.example\/(\d+)\.srt$/.exec(u);
    if (m) return new Response(files.find((f) => f.id === Number(m[1])).srt, { status: 200 });
    if (u.includes('/subtitle_raw_cache')) {
      calls.rawWrites.push(JSON.parse(init.body)[0]);
      return new Response('', { status: 201 });
    }
    return new Response('unexpected', { status: 500 });
  };
  return { calls, fetchImpl };
}
const EP = { tmdbId: 37680, type: 'tv', season: 1, episode: 1 };
const acceptAnchor = (srt) => anchorPresentInSrt(srt, ANCHOR);

test('alt: 今のファイルを除き、アンカーの在る候補を採用して raw cache に書く', async () => {
  const { calls, fetchImpl } = fakeOs({ files: [{ id: 1, srt: SRT_WITHOUT }, { id: 2, srt: SRT_WITH }] });
  const r = await fetchEpisodeSrtAlternative({ ...EP, excludeFileId: 1, accept: acceptAnchor }, { env: OS_ENV, fetchImpl, log: silentLog });
  assert.equal(r.fileId, 2);
  assert.equal(r.via, 'opensubtitles_alt');
  assert.equal(r.tried, 1);
  assert.deepEqual(calls.download, [2]); // 今のファイル(1)は DL しない
  assert.equal(calls.rawWrites.length, 1);
  assert.equal(calls.rawWrites[0].provider, 'opensubtitles:2');
  assert.equal(calls.rawWrites[0].cache_key, 'tmdb37680:s1e1');
});

test('alt: アンカーの無い候補は飛ばし、上限2件で打ち切る（raw cache は触らない）', async () => {
  const { calls, fetchImpl } = fakeOs({ files: [{ id: 1, srt: SRT_WITHOUT }, { id: 2, srt: SRT_WITHOUT }, { id: 3, srt: SRT_WITHOUT }, { id: 4, srt: SRT_WITH }] });
  const r = await fetchEpisodeSrtAlternative({ ...EP, excludeFileId: 1, accept: acceptAnchor }, { env: OS_ENV, fetchImpl, log: silentLog });
  assert.equal(r, null);
  assert.deepEqual(calls.download, [2, 3]); // 4 までは試さない（OS 枠の保護）
  assert.equal(calls.rawWrites.length, 0);
});

test('alt: 歌詞字幕・短すぎは accept の前に除外する', async () => {
  const music = srtOf(FILLER.map((l) => `♪ ${l} ♪ ♪ ♪ ♪ ♪ ♪ ♪ ♪`));
  const { calls, fetchImpl } = fakeOs({ files: [{ id: 1, srt: SRT_WITHOUT }, { id: 2, srt: music }, { id: 3, srt: 'short' }, { id: 4, srt: SRT_WITH }] });
  const r = await fetchEpisodeSrtAlternative({ ...EP, excludeFileId: 1, accept: () => { throw new Error('accept は呼ばれない'); } }, { env: OS_ENV, fetchImpl, log: silentLog });
  assert.equal(r, null);
  assert.deepEqual(calls.download, [2, 3]);
});

test('alt: 候補が1件（今のファイルだけ）なら何も DL しない', async () => {
  const { calls, fetchImpl } = fakeOs({ files: [{ id: 1, srt: SRT_WITHOUT }] });
  const r = await fetchEpisodeSrtAlternative({ ...EP, excludeFileId: 1, accept: acceptAnchor }, { env: OS_ENV, fetchImpl, log: silentLog });
  assert.equal(r, null);
  assert.equal(calls.search, 1);
  assert.deepEqual(calls.download, []);
});
