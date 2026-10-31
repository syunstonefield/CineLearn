// 2026-10-30 例文の補完（backfillMissingExamples）が、例文の無い手動追加の語に問い合わせない。
//   以前は「例文あり・📍なし」の判定が例文の有無を見ておらず、空のアンカーで1回問い合わせていた。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillMissingExamples } from '../lib/exampleBackfill.js';

const drama = { title: 'Suits', englishTitle: 'Suits', tmdbId: 37680, type: 'tv' };

// /api/example への問い合わせだけを数える（2026-10-31 から AI 作例で /api/claude も呼ぶため宛先で分ける）。
//   all には宛先つきで全部残す。example は /api/example の応答（既定は no_match）。
function captureFetch({ example = { found: false, reason: 'no_match' }, ai = { en: 'We need a merger to survive.', ja: '生き残るには合併が必要だ。' } } = {}) {
  const calls = [];
  calls.all = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.all.push({ url: String(url), body });
    if (String(url).includes('/api/claude')) return new Response(JSON.stringify(ai), { status: 200 });
    calls.push(body);
    return new Response(JSON.stringify(example), { status: 200 });
  };
  return calls;
}

test('例文の無い手動追加の語には問い合わせない', async () => {
  const calls = captureFetch();
  await backfillMissingExamples([{ word: 'spi', example: '', tsSec: null, origin: 'manual', season: 1, episode: 6 }], {
    drama,
    season: 1,
    episode: 6,
    isMovie: false,
  });
  assert.equal(calls.length, 0); // /api/example には問い合わせない（AI 作例は別・2026-10-31）
});

test('例文あり・📍なしの語は、例文をアンカーにして時刻を聞く（今まで通り）', async () => {
  const calls = captureFetch();
  await backfillMissingExamples(
    [{ word: 'trader', example: "She wasn't just a trader.", tsSec: null, origin: 'manual', season: 1, episode: 6 }],
    { drama, season: 1, episode: 6, isMovie: false }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lineText, "She wasn't just a trader.");
});

test('拡張で保存した例文の無い語は、例文の補完を聞く（今まで通り）', async () => {
  const calls = captureFetch();
  await backfillMissingExamples([{ word: 'grader', example: '', tsSec: null, origin: 'extension', season: 1, episode: 6 }], {
    drama,
    season: 1,
    episode: 6,
    isMovie: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lineText, undefined);
});

// ── 2026-10-31: 例文なしの自動補完（この回の別の場面 → AI 作例）──
import { aiExampleOf, isOtherSceneExample } from '../lib/exampleBackfill.js';
const aiCalls = (calls) => calls.all.filter((c) => c.url.includes('/api/claude'));

test('取り直しは「この回の別の場面」も探してよいと伝える（otherScene:true）', async () => {
  const calls = captureFetch();
  await backfillMissingExamples([{ word: 'symmetry', example: '', tsSec: 1921, origin: 'extension', season: 1, episode: 1 }], {
    drama, season: 1, episode: 1, isMovie: false,
  });
  assert.equal(calls[0].otherScene, true);
  assert.equal(calls[0].currentTimeSec, 1921);
});

test('📍修復（例文あり・時刻なし）では別の場面を探さない', async () => {
  const calls = captureFetch();
  await backfillMissingExamples([{ word: 'closer', example: "He's our best closer.", tsSec: null, origin: 'extension', season: 1, episode: 1 }], {
    drama, season: 1, episode: 1, isMovie: false,
  });
  assert.equal(calls[0].otherScene, undefined);
});

test('別の場面の台詞が返れば例文に入れ、注記 other_scene を付ける（AI 作例は作らない）', async () => {
  const calls = captureFetch({ example: { found: true, sentence: 'Mergers and acquisitions are my thing.', tsSec: 300, via: 'other_scene', otherScene: true } });
  const w = { word: 'mergers', example: '', tsSec: 1913, origin: 'extension', season: 1, episode: 1 };
  await backfillMissingExamples([w], { drama, season: 1, episode: 1, isMovie: false });
  assert.equal(w.example, 'Mergers and acquisitions are my thing.');
  assert.deepEqual(w.exampleNote, { kind: 'other_scene', of: 'Mergers and acquisitions are my thing.'.slice(0, 40) });
  assert.equal(w.tsSec, 1913); // 📍は保存した場面のまま
  assert.equal(isOtherSceneExample(w), true);
  assert.equal(aiCalls(calls).length, 0);
});

test('字幕から取れない（no_match）と分かった語に AI 作例を付ける。字幕の行は送らない', async () => {
  const calls = captureFetch();
  const w = { word: 'anchored', example: '', tsSec: 1910, origin: 'extension', pos: 'verb', ja: '固定された（この場面では拠点にした）', season: 1, episode: 1 };
  await backfillMissingExamples([w], { drama, season: 1, episode: 1, isMovie: false });
  const ai = aiCalls(calls);
  assert.equal(ai.length, 1);
  assert.equal(ai[0].body.mode, 'example_ai');
  assert.equal(ai[0].body.word, 'anchored');
  assert.equal(ai[0].body.sense, '固定された'); // 場面注記は落とす
  assert.equal(ai[0].body.sentence, undefined);
  assert.equal(ai[0].body.lineText, undefined);
  assert.equal(w.exampleNote.kind, 'ai');
  assert.equal(aiExampleOf(w).en, 'We need a merger to survive.');
  assert.equal(w.example, ''); // 例文欄には入れない（字幕の出所表示が付かない）
});

test('一時的な失敗（rate_limited）では AI 作例に倒さない', async () => {
  const calls = captureFetch({ example: { found: false, reason: 'rate_limited' } });
  const w = { word: 'acquisitions', example: '', tsSec: 1913, origin: 'extension', season: 1, episode: 1 };
  await backfillMissingExamples([w], { drama, season: 1, episode: 1, isMovie: false });
  assert.equal(aiCalls(calls).length, 0);
  assert.equal(w.exampleNote, undefined);
});

test('例文なしの手動追加の語は、字幕に問い合わせず AI 作例だけ付ける', async () => {
  const calls = captureFetch();
  const w = { word: 'retainer', example: '', tsSec: null, origin: 'manual', season: 1, episode: 2 };
  await backfillMissingExamples([w], { drama, season: 1, episode: 2, isMovie: false });
  assert.equal(calls.length, 0);
  assert.equal(aiCalls(calls).length, 1);
  assert.equal(w.exampleNote.kind, 'ai');
});

test('aiExampleOf は字幕の例文があれば出さない／isOtherSceneExample は例文が差し替わったら無効', () => {
  const note = { kind: 'ai', en: 'x merger y', ja: 'z' };
  assert.equal(aiExampleOf({ example: '', exampleNote: note }), note);
  assert.equal(aiExampleOf({ example: 'Real line.', exampleNote: note }), null);
  assert.equal(aiExampleOf({ sentence: 'Real line.', exampleNote: note }), null);
  const os = { kind: 'other_scene', of: 'Mergers and acquisitions' };
  assert.equal(isOtherSceneExample({ example: 'Mergers and acquisitions are my thing.', exampleNote: os }), true);
  assert.equal(isOtherSceneExample({ example: 'A different line now.', exampleNote: os }), false);
});

// 2026-10-31 文頭の偏り: v1 の「Honestly, …」の作例は作り直す。それ以外の作例はそのまま。
test('決まった書き出しの AI 作例は作り直し、それ以外は叩かない', async () => {
  const calls = captureFetch({ ai: { en: 'Did the mergers actually go through?', ja: '合併って本当に通ったの？' } });
  const stale = { word: 'mergers', example: '', origin: 'manual', exampleNote: { kind: 'ai', en: "Honestly, I'm surprised the mergers went through.", ja: '正直…' } };
  const fine = { word: 'symmetry', example: '', origin: 'manual', exampleNote: { kind: 'ai', en: 'The symmetry of this room calms me down.', ja: '…' } };
  await backfillMissingExamples([stale, fine], { drama, season: 1, episode: 1, isMovie: false });
  assert.deepEqual(aiCalls(calls).map((c) => c.body.word), ['mergers']);
  assert.equal(stale.exampleNote.en, 'Did the mergers actually go through?');
  assert.equal(fine.exampleNote.en, 'The symmetry of this room calms me down.');
});
