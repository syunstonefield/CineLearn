// subtitle_raw_cache の後追い投入（seed 済み行への raw バックフィル・2026-09-12・A14）。
//
// 背景: 単語生成がサーバ内で完結する経路（/api/vocab-generate）は生 SRT を subtitle_raw_cache に残すが、
//   それ以前に seed した行（2026-07-08 の 29 話など）は raw が無い。raw が無い話は
//   ・/api/example mode:'manual'（手動追加語の例文）が reason:'no_raw' で例文なし
//   ・lib/exampleBackfill（tsSec 無し語の📍修復）が層2で拾えない
//   ので、vocab_cache にある話ぶんの raw を OpenSubtitles から取り直して入れる。
//
// 何をするか:
//   vocab_cache（cache_version=V）の各行について
//     subtitle_raw_cache に未失効の raw があればスキップ（既存 raw は絶対に触らない）
//     → 無ければ 本番 /api/subtitles を seed 秘密ヘッダで search → 候補選別 → download
//     → 適合率チェック: その行の drama 語の example（字幕の逐語文）が DL した SRT に何割見つかるか。
//        --min-fit（既定 0.5）未満なら「生成に使った SRT と別物」とみなし次候補へ（最大 3 候補）。
//        ＝ tsSec/例文が指す場面と raw の場面がずれた状態で manual/backfill が走るのを防ぐ。
//     → service_role で subtitle_raw_cache に upsert（provider 'opensubtitles:<file_id>'・TTL 30 日）
//
// 実行（リポジトリ直下）:
//   node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-raw-cache.mjs            # dry-run（OS を叩かない）
//   node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-raw-cache.mjs --apply    # 実行
//   任意: --version=2（既定 env VOCAB_CACHE_VERSION||2） --tmdb=<id>（1作品だけ） --max=N（DL する話数の上限）
//         --min-fit=0.5（適合率の下限） --include-expired（失効済み raw も取り直す。既定は失効行も「有り」扱いでスキップ）
//
//   必要 env: SUPABASE_SERVICE_ROLE_KEY / CINELEARN_API_BASE / CINELEARN_API_ORIGIN / CL_SEED_SECRET
//   ※ OpenSubtitles の DL 枠（共有・日次）を消費する。1話=DL 1〜3 回。実行はオーナー判断（A30）。
//   ※ 生 SRT はログに出さない（A20）。文字数・件数・適合率だけ。
//   ※ 本番が seed 向け search を廃止していた場合（code:'search_unsupported'）は取り直せない＝中止して報告。

import { parseSrt, normApostrophes, selectSubtitleCandidates } from '../next-app/lib/subtitles.js';
import {
  API_BASE,
  API_ORIGIN,
  SUPABASE_URL,
  isFatal,
  listRawCacheMeta,
  rawCacheKey,
  rejectReasonOfSrt,
  seedDownloadSrt,
  seedSearch,
  sleep,
  upsertRawCacheRow,
  warnIfSeedHeaderMissing,
} from './lib/osdl.mjs';

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const VERSION = Number(args.version || process.env.VOCAB_CACHE_VERSION || 2);
const APPLY = args.apply === true;
const ONLY_TMDB = args.tmdb ? Number(args.tmdb) : 0;
const MAX = Number(args.max || 0);
const MIN_FIT = Number.isFinite(Number(args['min-fit'])) ? Number(args['min-fit']) : 0.5;
const INCLUDE_EXPIRED = args['include-expired'] === true;
const CANDIDATES_MAX = 3; // サーバ fetchEpisodeSrt と同じ上限（A5）
const PAUSE_MS = 1500; // 話と話の間（OS への連打を避ける）

function fail(msg) {
  console.error('✖', msg);
  process.exit(1);
}
if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY が未設定です（seed/.env）');
if (!API_BASE) fail('CINELEARN_API_BASE 未設定（例: https://cinelearn-next.vercel.app）');
if (!API_ORIGIN) fail('CINELEARN_API_ORIGIN 未設定（本番 API の Origin ゲートを通すため必要）');
if (!(VERSION > 0)) fail('--version が不正です');
if (!(MIN_FIT >= 0 && MIN_FIT <= 1)) fail('--min-fit は 0〜1');
warnIfSeedHeaderMissing();

const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function sbGet(q) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: sbHeaders, cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${q.split('?')[0]} HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── 適合率 ──
// 語の example は「字幕から一字一句抜き出した1文」（trimExampleToSentence 済み）なので、整形本文の中に
// 正規化して含まれるかで「同じ SRT か」を測れる。アポストロフィ・空白・記号ゆれだけ吸収する。
const norm = (s) =>
  normApostrophes(String(s || ''))
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// 戻り値 { fit:0..1, hit, total }。example を持つ語が1つも無ければ total=0・fit=1（判定不能＝通す）。
//   drama 語（字幕の逐語文）だけで測る。source 列が無い旧行は example 持ち全語で測る（plus の作例は当たらないので
//   低めに出る＝その場合は --min-fit を下げて判断する）。
function fitOfRaw(words, raw) {
  const hay = norm(parseSrt(raw));
  const withEx = words.filter((w) => w?.example);
  const drama = withEx.filter((w) => w.source === 'drama');
  const pool = drama.length ? drama : withEx;
  const examples = [...new Set(pool.map((w) => norm(w.example)).filter(Boolean))];
  if (!examples.length) return { fit: 1, hit: 0, total: 0 };
  let hit = 0;
  for (const ex of examples) if (hay.includes(ex)) hit++;
  return { fit: hit / examples.length, hit, total: examples.length };
}

const fmtFit = ({ fit, hit, total }) => (total ? `${Math.round(fit * 100)}% (${hit}/${total})` : 'n/a');

// 1 話ぶん: search → 候補 → DL → 採否（歌詞/短すぎ/適合率）→ upsert。戻り値は結果種別。
async function backfillRow(r) {
  const type = r.season === 0 && r.episode === 0 ? 'movie' : 'tv';
  const words = Array.isArray(r.words) ? r.words : [];
  const subs = await seedSearch({ tmdbId: r.tmdb_id, type, season: r.season, episode: r.episode });
  const sorted = selectSubtitleCandidates(subs, type === 'movie', r.season, r.episode);
  if (!sorted.length) {
    console.warn('    ⚠ OpenSubtitles に候補なし → スキップ');
    return 'nosub';
  }
  let tried = 0;
  let bestFit = null;
  for (const cand of sorted.slice(0, CANDIDATES_MAX)) {
    const fid = cand?.attributes?.files?.[0]?.file_id;
    if (!fid) continue;
    tried++;
    const text = await seedDownloadSrt(fid);
    const reject = rejectReasonOfSrt(text);
    if (reject) {
      console.log(`    候補${tried} file_id=${fid}: ${reject === 'music' ? '歌詞ばかり' : reject === 'short' ? '短すぎ' : '空'} → 次候補`);
      continue;
    }
    const f = fitOfRaw(words, text);
    if (!bestFit || f.fit > bestFit.fit) bestFit = f;
    if (f.fit < MIN_FIT) {
      console.log(`    候補${tried} file_id=${fid}: ${text.length} 字・適合率 ${fmtFit(f)} < ${MIN_FIT} → 次候補`);
      continue;
    }
    await upsertRawCacheRow({ tmdbId: r.tmdb_id, season: r.season, episode: r.episode, raw: text, fileId: fid });
    console.log(`    ✅ 候補${tried} file_id=${fid}: ${text.length} 字・適合率 ${fmtFit(f)} → subtitle_raw_cache に投入`);
    return 'ok';
  }
  console.warn(`    ⚠ 採用できる候補なし（試行 ${tried}・最高適合率 ${bestFit ? fmtFit(bestFit) : '-'}）→ スキップ（--min-fit を下げるかは要判断）`);
  return 'unfit';
}

async function main() {
  console.log(
    `raw バックフィル（v${VERSION}・${APPLY ? '★実行' : 'dry-run'}・min-fit ${MIN_FIT}${ONLY_TMDB ? `・tmdb ${ONLY_TMDB}` : ''}${MAX ? `・max ${MAX}` : ''}）`
  );
  const rows = await sbGet(
    `vocab_cache?cache_version=eq.${VERSION}${ONLY_TMDB ? `&tmdb_id=eq.${ONLY_TMDB}` : ''}` +
      `&select=cache_key,tmdb_id,season,episode,display_title,subtitle_provider,words&order=updated_at.desc`
  );
  const rawMeta = await listRawCacheMeta();

  // 対象 = raw が無い（--include-expired なら失効済みも）行。既存 raw は触らない。
  const targets = [];
  let have = 0;
  for (const r of rows) {
    const meta = rawMeta.get(rawCacheKey(r.tmdb_id, r.season, r.episode));
    if (meta && (!meta.expired || !INCLUDE_EXPIRED)) {
      have++;
      continue;
    }
    targets.push(r);
  }
  for (const r of targets) {
    const n = (r.words || []).filter((w) => w?.source === 'drama' && w.example).length;
    console.log(`  ${r.cache_key.padEnd(24)} drama例文 ${String(n).padStart(3)}  ${r.subtitle_provider || ''}  ${r.display_title || ''}`);
  }
  console.log(`vocab_cache ${rows.length} 行のうち raw あり ${have}・対象 ${targets.length} 行${MAX && targets.length > MAX ? `（今回は先頭 ${MAX} 行）` : ''}`);
  if (!APPLY) {
    console.log('dry-run のため OpenSubtitles も Supabase 書込も無し。実行するには --apply を付ける。');
    return;
  }

  const counts = {};
  const bump = (k) => (counts[k] = (counts[k] || 0) + 1);
  let done = 0;
  for (const r of targets) {
    if (MAX && done >= MAX) break;
    done++;
    console.log(`\n▶ ${r.display_title || ''} ${r.cache_key}`);
    try {
      bump(await backfillRow(r));
    } catch (err) {
      bump('failed');
      console.error('  ❌', err.message);
      if (isFatal(err)) {
        console.error(`✖ 続行しても同じ失敗になる（${err.code}）→ 走査を中止`);
        break;
      }
    }
    await sleep(PAUSE_MS);
  }
  const summary = Object.entries(counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(' / ');
  console.log(`\n完了: ${summary || '対象なし'}（残り ${Math.max(0, targets.length - done)} 行は再実行で続きから・既存 raw はスキップ）`);
}

main().catch((err) => {
  console.error('✖', err.message);
  process.exit(1);
});
