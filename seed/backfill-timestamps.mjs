// タイムスタンプ・バックフィル（既存キャッシュの「時刻だけ」付け直し）。
//
// 何をするか:
//   TARGETS の各エピソードについて
//     vocab_cache から既存 words を読む（← Claude 再生成はしない＝コスト/語の差し替えなし）
//     → 本番 /api/subtitles 経由で生 SRT を取得
//     → attachBaseTimestamps で各語に tsSec/tsLabel を付与（VOD 補正なし・secToTimeLabel は時間繰り上げ対応）
//     → words 配列を差し替えて vocab_cache に upsert（他カラムは元の値を保持）
//
//   用途: 時刻保存機能の追加前にシードした行（例: Suits S1E1 = 全語 時刻なし）の修復。
//   既に時刻が付いている行に流しても、生 SRT から付け直すだけで安全（語は増減しない）。
//
// 実行（seed-vocab.mjs と同じ流儀）:
//   node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-timestamps.mjs
//
//   必要 env: SUPABASE_SERVICE_ROLE_KEY / CINELEARN_API_BASE / CINELEARN_API_ORIGIN
//   任意 env: SUPABASE_URL（既定=本番）/ VOCAB_CACHE_VERSION（既定=1・api/vocab と一致）

import { searchSubtitles, downloadSubtitle } from '../next-app/lib/api.js';
import { selectSubtitleCandidates, parseSrt, attachBaseTimestamps } from '../next-app/lib/subtitles.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CACHE_VERSION = Number(process.env.VOCAB_CACHE_VERSION || 1);

// 指定シーズンの episode 範囲を [{season,episode}...] に展開（seed-vocab.mjs と同じ流儀）。
const eps = (season, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ season, episode: from + i }));

// ── 対象（Suits S1 全話）──
// tsSec を example 基準に揃える修正後の付け直し。既に正しい行は値変更検知で書込見送り。
// 行が無い回（範囲超過）は fetchRow が null を返し自動スキップ。
const TARGETS = [
  {
    tmdbId: 37680,
    title: 'Suits',
    englishTitle: 'Suits',
    type: 'tv',
    episodes: eps(1, 1, 12), // Suits Season 1 全話（E1〜E12）
  },
];

function fail(msg) {
  console.error('✖', msg);
  process.exit(1);
}
if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY が未設定です（Supabase の service_role キー）。');
if (!process.env.CINELEARN_API_BASE) fail('CINELEARN_API_BASE 未設定（例: https://cine-learn.vercel.app）。字幕取得に本番 API を使う。');
if (!process.env.CINELEARN_API_ORIGIN) fail('CINELEARN_API_ORIGIN 未設定（本番 API の Origin ゲートを通すため必要）。');

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

// 既存行を 1 件取得（service_role で読む）。なければ null。
async function fetchRow(cacheKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`,
    { headers: authHeaders, cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`read 失敗 HTTP ${res.status}: ${await res.text()}`);
  const rows = JSON.parse(await res.text());
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// 行をまるごと upsert（words 差し替え済みの完全な行を渡す＝他カラムを失わない）。
async function upsertRow(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vocab_cache?on_conflict=cache_key`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    cache: 'no-store',
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`upsert 失敗 HTTP ${res.status}: ${await res.text()}`);
}

// fetchEpisodeSubtitle の localStorage 非依存部分（検索→候補選別→DL）。生 SRT を返す。
async function fetchRawSrt(drama, season, episode) {
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
    if (musicRatio > 5) continue; // 歌詞ばかりは除外（本取得と同基準）
    if (parseSrt(text).length < 200) continue; // 短すぎる字幕は信頼しない
    return text;
  }
  return null;
}

const tsCount = (words) => words.filter((w) => w.tsSec != null).length;

async function backfillEpisode(t, season, episode) {
  const drama = { title: t.title, englishTitle: t.englishTitle, type: t.type, tmdbId: t.tmdbId };
  const s = t.type === 'movie' ? 0 : season;
  const e = t.type === 'movie' ? 0 : episode;
  const cacheKey = `v${CACHE_VERSION}:tmdb${t.tmdbId}:s${s}e${e}`;
  console.log(`\n▶ ${t.title} S${season}E${episode}  (${cacheKey})`);

  const row = await fetchRow(cacheKey);
  if (!row) {
    console.warn('  ⚠ 行が無い → スキップ（まず seed-vocab で生成が必要）');
    return;
  }
  const words = Array.isArray(row.words) ? row.words : [];
  if (!words.length) {
    console.warn('  ⚠ words 空 → スキップ');
    return;
  }
  const before = tsCount(words);
  // 修復前の tsSec を語ごとに退避（値変更検知用）。attachBaseTimestamps は in-place で
  // words を書き換えるため、上書き前に控える。
  const beforeTs = new Map(words.map((w) => [w.word, w.tsSec ?? null]));
  console.log(`  既存 ${words.length} 語（時刻付き ${before}）`);

  const rawSrt = await fetchRawSrt(drama, season, episode);
  if (!rawSrt) {
    console.warn('  ⚠ 字幕が取得できない → スキップ（既存データは変更しない）');
    return;
  }
  console.log(`  生 SRT ${rawSrt.length} 文字 取得`);

  // 各語に tsSec/tsLabel を付与（in-place・VOD 補正なし）。語の増減は無し。
  attachBaseTimestamps(words, { title: drama.englishTitle || drama.title, season, episode, rawSrt });
  const after = tsCount(words);

  // ★安全ガードは「値変更検知」。今回の修復は語数同じで tsSec の値だけ正すため、
  //   付与数（after vs before）では差が出ず全件スキップになる。tsSec が1つでも
  //   変われば書く／全く変わらなければ書込見送り、という恒久的に安全な判定にする。
  const changed = words.filter((w) => (w.tsSec ?? null) !== (beforeTs.get(w.word) ?? null)).length;
  if (changed === 0) {
    console.log(`  ＝ tsSec 変化なし（時刻付き ${before}→${after}）→ 書込見送り（既に正しい）`);
    return;
  }
  console.log(`  tsSec 変化: ${changed} 語（時刻付き ${before}→${after}）→ 更新`);

  row.words = words;
  row.word_count = words.length;
  row.updated_at = new Date().toISOString();
  await upsertRow(row);
  console.log('  ✅ vocab_cache を更新');
}

async function main() {
  console.log(`バックフィル開始（cache_version=${CACHE_VERSION}, base=${process.env.CINELEARN_API_BASE}）`);
  let ok = 0;
  let ng = 0;
  for (const t of TARGETS) {
    for (const ep of t.episodes) {
      try {
        await backfillEpisode(t, ep.season, ep.episode);
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
