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
import { selectSubtitleCandidates, parseSrt } from '../next-app/lib/subtitles.js';

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
// ※ Suits S1E1 はシード済みなので E2 から（E1 を含めても upsert で上書きされるだけ・Claude 1回分の無駄）。
// ※ 実在しない回（範囲を超えた episode）は字幕が見つからず自動スキップ（クォータ・コスト消費なし）。
const TARGETS = [
  {
    tmdbId: 37680,
    title: 'Suits',
    englishTitle: 'Suits',
    display: 'Suits',
    type: 'tv',
    episodes: eps(1, 2, 12), // Suits Season 1 残り（E2〜E12・約11話）
  },
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
    return parseSrt(text);
  }
  const fid = sorted[0].attributes.files[0].file_id;
  const text = await downloadSubtitle(fid);
  return text ? parseSrt(text) : null;
}

async function seedEpisode(t, season, episode) {
  const drama = { title: t.title, englishTitle: t.englishTitle, type: t.type, tmdbId: t.tmdbId };
  const s = t.type === 'movie' ? 0 : season;
  const e = t.type === 'movie' ? 0 : episode;
  const cacheKey = `v${CACHE_VERSION}:tmdb${t.tmdbId}:s${s}e${e}`;
  console.log(`\n▶ ${t.display} S${season}E${episode}  (${cacheKey})`);

  const subtitleText = await fetchSubtitleText(drama, season, episode);
  if (!subtitleText || subtitleText.length < 200) {
    console.warn('  ⚠ 字幕が取得できない/短すぎ → スキップ');
    return;
  }
  console.log(`  字幕 ${subtitleText.length} 文字`);

  const raw = await generateSuperset({ drama, season, episode, subtitleText, vocabCount: 40 });
  await fillMissingExampleJa(raw); // example_ja を補完（in-place）
  // 保存用に transient フラグを落とす
  const words = raw.map(({ example_ja_ok, ...w }) => w);

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
  console.log(`シード開始（cache_version=${CACHE_VERSION}, base=${process.env.CINELEARN_API_BASE}）`);
  let ok = 0;
  let ng = 0;
  for (const t of TARGETS) {
    for (const ep of t.episodes) {
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
