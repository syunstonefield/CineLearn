// 2026-11-12 不具合2件の直し: ①選んだ作品の ID を題名検索で上書きしない ②外国語の部分だけ・CD分割の字幕を避ける ③本人にも品質の確認を通った語だけ。
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.VOCAB_CACHE_VERSION = '2';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownTitleCandidate } from '../lib/tmdb.js';
import { selectSubtitleCandidates } from '../lib/subtitles.js';
const { generateEpisodeVocab } = await import('../lib/server/vocabGen.js');

test('knownTitleCandidate: ID と mediaType があればその ID（X-Men 2000 を Apocalypse に置き換えない）', () => {
  const c = knownTitleCandidate({ title: 'X-MEN', englishTitle: 'X-Men', tmdbId: 36657, mediaType: 'movie', posterPath: '/p.jpg' });
  assert.deepEqual(c, { type: 'movie', tmdbId: 36657, englishTitle: 'X-Men', year: '', posterPath: '/p.jpg' });
  assert.equal(knownTitleCandidate({ title: 'Loki', tmdbId: 84958, mediaType: 'tv' }).type, 'tv');
  assert.equal(knownTitleCandidate({ title: 'Loki', tmdbId: 84958, mediaType: 'tv' }).englishTitle, 'Loki');
  // ID の無い古い一覧・mediaType の無いもの（古い記録の type は信じない）は題名で探す
  assert.equal(knownTitleCandidate({ title: 'X-MEN' }), null);
  assert.equal(knownTitleCandidate({ title: 'X-MEN', tmdbId: 36657, type: 'tv' }), null);
  assert.equal(knownTitleCandidate({ title: 'X-MEN', tmdbId: 'abc', mediaType: 'movie' }), null);
  assert.equal(knownTitleCandidate(null), null);
});

const sub = (id, attrs = {}) => ({
  attributes: {
    download_count: 100,
    release: `Movie.2000.${id}`,
    files: [{ file_id: id, file_name: `Movie.2000.${id}.srt` }],
    feature_details: { feature_type: 'Movie' },
    ...attrs,
  },
});

test('字幕の候補: 外国語の部分だけ（印・forced の名前）は除き、CD に分かれた版は後回し', () => {
  const list = [
    sub(1, { foreign_parts_only: true, download_count: 9000 }),
    sub(2, { release: 'Movie.2000.FORCED.BluRay', download_count: 8000 }),
    sub(3, { files: [{ file_id: 31 }, { file_id: 32 }], download_count: 7000 }), // CD1/CD2
    sub(4, { download_count: 50 }),
    sub(5, { hearing_impaired: true, download_count: 6000 }),
  ];
  const ids = selectSubtitleCandidates(list, true, 0, 0).map((s) => s.attributes.files[0].file_id);
  assert.deepEqual(ids, [4, 5, 31]);
  // 外国語の部分だけしか無ければ候補なし
  assert.deepEqual(selectSubtitleCandidates([sub(1, { foreign_parts_only: true })], true, 0, 0), []);
  // CD 分割しか無ければそれを使う（無いよりはよい）
  assert.equal(selectSubtitleCandidates([sub(3, { files: [{ file_id: 31 }, { file_id: 32 }] })], true, 0, 0).length, 1);
});

test('generateEpisodeVocab: 本人に返す words も品質の確認を通った語だけ（storeWords と同じ）', async () => {
  const words = ['subpoena', 'deposition', 'litigation', 'injunction', 'liability', 'negotiate', 'acquisition', 'leverage', 'scrutiny',
    'tenacity', 'paramount', 'meticulous', 'ambivalent', 'prognosis', 'malignant', 'diagnosis', 'liquidity', 'perfunctory',
    'recalcitrant', 'ineffable', 'comprehensive', 'inevitable', 'deliberately', 'acknowledge', 'schedule'];
  const line = (w) => `We talked about the ${w} for a while today.`;
  const ts = (s) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
  const raw = words.map((w, i) => `${i + 1}\n${ts(5 + i * 10)} --> ${ts(7 + i * 10)}\n${line(w)}\n`).join('\n');
  const W = (w, e, d = `${w} の意味`) => ({ w, l: 'C1', p: '名詞', d, e, t: 'core', c: '' });
  const reply = JSON.stringify({
    drama: [...words.map((w) => W(w, line(w))), W('verdict', line('subpoena'), '')], // 意味の無い語＝品質の確認で落ちる
    plus: [W('ubiquitous', 'Phones are ubiquitous.')],
  });
  const r = await generateEpisodeVocab(
    { tmdbId: 1, type: 'tv', season: 1, episode: 1 },
    {
      log: { info() {}, warn() {}, log() {}, error() {} },
      resolveTitles: async () => ({ englishTitle: 'Suits', displayTitle: 'スーツ' }),
      fetchSrt: async () => ({ raw, fileId: 1, via: 'opensubtitles' }),
      callLlm: async () => reply,
    }
  );
  assert.ok(!r.words.some((w) => w.word === 'verdict'));
  assert.deepEqual(r.words.map((w) => w.word), r.storeWords.map((w) => w.word));
  assert.equal(r.wordCount, r.words.length);
});
