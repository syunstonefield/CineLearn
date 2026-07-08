// 共有単語キャッシュのシードスクリプト（Phase 0 / A：リーン版）。
//
// 何をするか:
//   TARGETS の各エピソードについて
//     字幕取得（本番 /api/subtitles 経由）→ generateSuperset（A2〜C2 を広く生成）
//     → fillMissingExampleJa（和訳補完）→ 品質ゲート → vocab_cache に upsert（service_role）
//     → catalog に作品行を upsert
//   生成ロジックは next-app/lib をそのまま再利用（プロンプト/整形のドリフトを避ける）。
//
// 実行（要：拡張子なし import を解決するフック）:
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   CINELEARN_API_BASE=https://cine-learn.vercel.app \
//   CINELEARN_API_ORIGIN=https://cine-learn.vercel.app \
//   node --import ./seed/register-hooks.mjs seed/seed-vocab.mjs
//
//   ※ 字幕取得・Claude 生成は本番 Vercel Functions を Origin 付きで叩く（_origin.js のゲートを通す）。
//     これにより本番の OpenSubtitles クォータ（決定事項C）と Anthropic キーを使う。
//   ※ 書き込みは service_role（RLS バイパス）。キーは絶対にコミットしない。

import { generateSuperset, fillMissingExampleJa } from '../next-app/lib/vocab.js';
import { searchSubtitles, downloadSubtitle } from '../next-app/lib/api.js';
import { selectSubtitleCandidates, parseSrt, attachBaseTimestamps } from '../next-app/lib/subtitles.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CACHE_VERSION = Number(process.env.VOCAB_CACHE_VERSION || 1);
const MODEL = 'claude-haiku-4-5-20251001'; // api/claude.js と一致
const PROVIDER = 'opensubtitles';
const MIN_WORDS = 20; // 品質ゲート（最低限）。これ未満は書き込まない

// 指定シーズンの episode 範囲を [{season,episode}...] に展開するヘルパー。
const eps = (season, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ season, episode: from + i }));

// ── シード対象 ──
// ※ 実在しない回（範囲を超えた episode）は字幕が見つからず自動スキップ（クォータ・コスト消費なし）。
// ※ 週30話上限・単一作品を短期集中で埋めない（docs/design-curated-catalog.md §5・legal R2）。
//   → 1作品4話×7作品＋映画1本＝29話/週。翌週以降は各作品の続き＋リクエスト上位を足す。
// ※ tmdb_id は 2026-07-07 に本番 /api/tmdb で実確認済み。
const TARGETS = [
  { tmdbId: 66732, title: 'Stranger Things', englishTitle: 'Stranger Things', display: 'Stranger Things', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 1396, title: 'Breaking Bad', englishTitle: 'Breaking Bad', display: 'Breaking Bad', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 82596, title: 'Emily in Paris', englishTitle: 'Emily in Paris', display: 'Emily in Paris', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 66573, title: 'The Good Place', englishTitle: 'The Good Place', display: 'The Good Place', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 1421, title: 'Modern Family', englishTitle: 'Modern Family', display: 'Modern Family', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 65494, title: 'The Crown', englishTitle: 'The Crown', display: 'The Crown', type: 'tv', episodes: eps(1, 1, 4) },
  { tmdbId: 77169, title: 'Cobra Kai', englishTitle: 'Cobra Kai', display: 'Cobra Kai', type: 'tv', episodes: eps(1, 1, 4) },
  // 映画（続編2026公開の便乗枠・marketing R1）
  { tmdbId: 350, title: 'The Devil Wears Prada', englishTitle: 'The Devil Wears Prada', display: 'プラダを着た悪魔', type: 'movie', episodes: [{ season: 0, episode: 0 }] },
];

function fail(msg) {
  console.error('✖', msg);
  process.exit(1);
}
if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY が未設定です（Supabase の service_role キー）。');
if (!process.env.CINELEARN_API_BASE) {
  fail('CINELEARN_API_BASE 未設定（例: https://cine-learn.vercel.app）。字幕/生成は本番 API を叩きます。');
}
if (!process.env.CINELEARN_API_ORIGIN) {
  fail('CINELEARN_API_ORIGIN 未設定（例: https://cine-learn.vercel.app）。本番 API の Origin ゲートを通すため必要。');
}

const titleNorm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '_');

// service_role で upsert（on_conflict で重複は更新）。
async function sbUpsert(table, rows, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table} upsert 失敗 HTTP ${res.status}: ${await res.text()}`);
}

// fetchEpisodeSubtitle の localStorage 非依存部分を再現（検索→候補選別→DL→parseSrt）。
async function fetchSubtitleText(drama, season, episode) {
  const isMovie = drama.type === 'movie';
  const subs = await searchSubtitles(
    drama.englishTitle || drama.title,
    season,
    episode,
    isMovie ? 'movie' : 'tv',
    isMovie ? drama.tmdbId : null
  );
  const sorted = selectSubtitleCandidates(subs, isMovie, season, episode);
  if (!sorted.length) return null;
  for (const cand of sorted.slice(0, 3)) {
    const fid = cand.attributes.files[0].file_id;
    const text = await downloadSubtitle(fid);
    if (!text) continue;
    const musicRatio = (text.match(/♪/g) || []).length / (text.length / 100);
    if (musicRatio > 5) continue; // 歌詞ばかりの字幕は除外（本取得と同基準）
    return { parsed: parseSrt(text), raw: text };
  }
  const fid = sorted[0].attributes.files[0].file_id;
  const text = await downloadSubtitle(fid);
  return text ? { parsed: parseSrt(text), raw: text } : null;
}

// 既にキャッシュ済みならスキップ（週次の再実行で二重生成＝二重課金を防ぐ）。
async function isCached(cacheKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=cache_key&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function seedEpisode(t, season, episode) {
  const drama = { title: t.title, englishTitle: t.englishTitle, type: t.type, tmdbId: t.tmdbId };
  const s = t.type === 'movie' ? 0 : season;
  const e = t.type === 'movie' ? 0 : episode;
  const cacheKey = `v${CACHE_VERSION}:tmdb${t.tmdbId}:s${s}e${e}`;
  console.log(`\n▶ ${t.display} S${season}E${episode}  (${cacheKey})`);
  if (await isCached(cacheKey)) {
    console.log('  ⏭ キャッシュ済み → スキップ（生成・クォータ消費なし）');
    return;
  }

  const sub = await fetchSubtitleText(drama, season, episode);
  if (!sub || !sub.parsed || sub.parsed.length < 200) {
    console.warn('  ⚠ 字幕が取得できない/短すぎ → スキップ');
    return;
  }
  const subtitleText = sub.parsed;
  console.log(`  字幕 ${subtitleText.length} 文字`);

  const gen = await generateSuperset({ drama, season, episode, subtitleText, vocabCount: 40 });
  await fillMissingExampleJa(gen); // example_ja を補完（in-place）
  // ベース字幕時刻（📍）を各語へ付与（生SRTから・VOD補正なし）
  attachBaseTimestamps(gen, { title: drama.englishTitle || drama.title, season, episode, rawSrt: sub.raw });
  // 保存用に transient フラグを落とす
  const words = gen.map(({ example_ja_ok, ...w }) => w);

  const dramaCount = words.filter((w) => w.source === 'drama').length;
  if (words.length < MIN_WORDS) {
    console.warn(`  ⚠ 語数不足(${words.length} < ${MIN_WORDS}) → 書込見送り`);
    return;
  }
  console.log(`  生成 ${words.length} 語（drama ${dramaCount} / plus ${words.length - dramaCount}）`);

  await sbUpsert(
    'catalog',
    [{ tmdb_id: t.tmdbId, title_norm: titleNorm(t.title), display_title: t.display, type: t.type, enabled: true }],
    'tmdb_id'
  );
  await sbUpsert(
    'vocab_cache',
    [
      {
        cache_key: cacheKey,
        cache_version: CACHE_VERSION,
        tmdb_id: t.tmdbId,
        season: s,
        episode: e,
        display_title: t.display,
        title_norm: titleNorm(t.title),
        words,
        word_count: words.length,
        coverage_min: 'A2',
        coverage_max: 'C2',
        subtitle_provider: PROVIDER,
        model: MODEL,
        updated_at: new Date().toISOString(),
      },
    ],
    'cache_key'
  );
  console.log('  ✅ vocab_cache に書込');
}

async function main() {
  // SEED_MAX_EPISODES=N でN話処理したら停止（パイロット実行・週次上限の分割消化用）
  const maxEps = Number(process.env.SEED_MAX_EPISODES || 0);
  console.log(`シード開始（cache_version=${CACHE_VERSION}, base=${process.env.CINELEARN_API_BASE}${maxEps ? `, max=${maxEps}話` : ''}）`);
  let ok = 0;
  let ng = 0;
  let done = 0;
  outer: for (const t of TARGETS) {
    for (const ep of t.episodes) {
      if (maxEps && done >= maxEps) break outer;
      done++;
      try {
        await seedEpisode(t, ep.season, ep.episode);
        ok++;
      } catch (err) {
        ng++;
        console.error('  ❌', err.message);
      }
    }
  }
  console.log(`\n完了：成功 ${ok} / 失敗 ${ng}`);
}

main();
