// タイムスタンプ検証（読取専用・DBは書き換えない）。
//
// 何をするか:
//   TARGETS の各エピソードについて
//     vocab_cache から既存 words を読む（service_role・読取のみ）
//     → 生 SRT を取得（subtitle_raw_cache → 無ければ本番 /api/subtitles を seed 秘密ヘッダで・seed/lib/osdl.mjs）
//     → 修正後ロジック（attachBaseTimestamps）で tsSec を再計算
//     → 保存済み tsSec（before）と再計算 tsSec（after）を語ごとに並べて表示
//
//   用途: backfill を流す前に「📍時刻と example の不一致が解消するか」を実 SRT で確認する。
//   WATCH に挙げた語（plaintiff / grown man / close / suit / potential 等）は必ず表示する。
//
// 実行:
//   node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/verify-timestamps.mjs
//
//   必要 env: SUPABASE_SERVICE_ROLE_KEY / CINELEARN_API_BASE / CINELEARN_API_ORIGIN / CL_SEED_SECRET
//     （CINELEARN_API_BASE・ORIGIN は https://cinelearn-next.vercel.app。download は seed 秘密ヘッダ必須・2026-09-12）
//   ※ DBへの書き込みは一切しない（読取専用）。鍵は出力しない。

import { attachBaseTimestamps } from '../next-app/lib/subtitles.js';
import { API_BASE, API_ORIGIN, isFatal, seedFetchRawSrt, warnIfSeedHeaderMissing } from './lib/osdl.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CACHE_VERSION = Number(process.env.VOCAB_CACHE_VERSION || 1);

const TARGETS = [
  { tmdbId: 37680, title: 'Suits', englishTitle: 'Suits', type: 'tv', episodes: [{ season: 1, episode: 1 }] },
];

// 大ずれが確認されていた監視語（before/after を強調表示）。
const WATCH = new Set(['plaintiff', 'grown man', 'close', 'suit', 'potential']);

function fail(msg) {
  console.error('✖', msg);
  process.exit(1);
}
if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY が未設定です。');
if (!API_BASE) fail('CINELEARN_API_BASE 未設定。');
if (!API_ORIGIN) fail('CINELEARN_API_ORIGIN 未設定。');
warnIfSeedHeaderMissing();

const authHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function fetchRow(cacheKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`,
    { headers: authHeaders, cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`read 失敗 HTTP ${res.status}: ${await res.text()}`);
  const rows = JSON.parse(await res.text());
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// 生 SRT を取る。subtitle_raw_cache（service_role）→ 無ければ本番 /api/subtitles（seed 秘密ヘッダ・search→候補→DL）。
//   raw cache を先に読むのは「生成に使った SRT と同じ物」で tsSec を付け直すため（別候補だと example とずれる）。
//   戻り値 { raw, via } | null（字幕なし）。生 SRT はログに出さない（A20）。
async function fetchRawSrt(drama, season, episode) {
  const got = await seedFetchRawSrt({ tmdbId: drama.tmdbId, type: drama.type, season, episode });
  return got ? { raw: got.raw, via: got.via } : null;
}

async function verifyEpisode(t, season, episode) {
  const drama = { title: t.title, englishTitle: t.englishTitle, type: t.type, tmdbId: t.tmdbId };
  const s = t.type === 'movie' ? 0 : season;
  const e = t.type === 'movie' ? 0 : episode;
  const cacheKey = `v${CACHE_VERSION}:tmdb${t.tmdbId}:s${s}e${e}`;
  console.log(`\n▶ ${t.title} S${season}E${episode}  (${cacheKey})`);

  const row = await fetchRow(cacheKey);
  if (!row) return console.warn('  ⚠ 行が無い');
  const words = Array.isArray(row.words) ? row.words : [];
  if (!words.length) return console.warn('  ⚠ words 空');

  // before = 保存済み tsSec を控える（参照渡しで上書きされる前に退避）
  const before = new Map(words.map((w) => [w.word, w.tsSec ?? null]));

  const got = await fetchRawSrt(drama, season, episode);
  if (!got) return console.warn('  ⚠ 字幕が取得できない');
  const rawSrt = got.raw;
  console.log(`  生 SRT ${rawSrt.length} 文字 取得（${got.via === 'raw_cache' ? 'subtitle_raw_cache' : 'OpenSubtitles'}）/ ${words.length} 語`);

  // 修正後ロジックで after を計算（in-place 上書き＝DBには書かない）
  attachBaseTimestamps(words, { title: drama.englishTitle || drama.title, season, episode, rawSrt });

  let changed = 0;
  const fmt = (v) => (v == null ? '  null' : String(v).padStart(6));
  console.log('  word                 before   after   Δ    example(先頭60字)');
  for (const w of words) {
    const b = before.get(w.word);
    const a = w.tsSec ?? null;
    if (b !== a) changed++;
    const isWatch = WATCH.has(w.word.toLowerCase());
    if (!isWatch && b === a) continue; // 監視語 or 変化した語のみ表示
    const delta = b != null && a != null ? a - b : '-';
    const mark = isWatch ? '★' : ' ';
    const ex = (w.example || '').replace(/\s+/g, ' ').slice(0, 60);
    console.log(`  ${mark}${w.word.padEnd(18)} ${fmt(b)}  ${fmt(a)}  ${String(delta).padStart(5)}  ${ex}`);
  }
  console.log(`  → 変化した語: ${changed} / ${words.length}`);
}

async function main() {
  console.log(`検証開始（読取専用・cache_version=${CACHE_VERSION}, base=${API_BASE}）`);
  outer: for (const t of TARGETS) {
    for (const ep of t.episodes) {
      try {
        await verifyEpisode(t, ep.season, ep.episode);
      } catch (err) {
        console.error('  ❌', err.message);
        if (isFatal(err)) {
          console.error(`✖ 続行しても同じ失敗になる（${err.code}）→ 走査を中止`);
          break outer;
        }
      }
    }
  }
  console.log('\n完了（DBは変更していません）');
}

main();
