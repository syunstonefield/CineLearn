// 共有単語キャッシュ（vocab_cache）の空欄 example_ja を埋め直すスクリプト（2026-09-11）。
//
// 背景: 自動寄与行は生成直後に和訳なしで書かれ、以後埋まる経路が無かった（本番 v2 の 14 行・1,318 語）。
//   本番 /api/claude の mode:'sentences' を叩くと、サーバが共有キャッシュを引き、未命中だけ Haiku で訳し、
//   応答後に translation_ctx_cache と vocab_cache の空欄を埋める。このスクリプトは行を走査して
//   その API を呼ぶだけ＝サーバ側と二重に書いても冪等（空欄しか埋めない）。念のため自分でも行を patch する。
//
// 実行（リポジトリ直下）:
//   node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-example-ja.mjs           # dry-run
//   node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/backfill-example-ja.mjs --apply   # 実行
//   任意: --version=2（既定 env VOCAB_CACHE_VERSION||2） --max-batches=N（枠の温存用）
// レート制限（'sentences' 30/分・100/時・200/日・IP単位）に当たったら 65 秒待って同じバッチを再試行する。
// 1時間 100 バッチ ≒ 1,000 文なので、初回は時間をおいて 2 回に分けて流す想定。

import { translateSentences } from '../next-app/lib/api.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const VERSION = Number(args.version || process.env.VOCAB_CACHE_VERSION || 2);
const APPLY = args.apply === true;
const MAX_BATCHES = Number(args['max-batches'] || 0);
const BATCH = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!SERVICE_KEY) {
  console.error('✖ SUPABASE_SERVICE_ROLE_KEY が未設定です（seed/.env）');
  process.exit(1);
}
if (!process.env.CINELEARN_API_BASE || !process.env.CINELEARN_API_ORIGIN) {
  console.error('✖ CINELEARN_API_BASE / CINELEARN_API_ORIGIN が未設定です（seed/.env・本番 API を叩く）');
  process.exit(1);
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const keyOf = (s) => String(s || '').trim().slice(0, 300);

async function sbGet(q) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers });
  if (!res.ok) throw new Error(`GET HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// 空欄だけを埋めた words を書き戻す（サーバ側 after() と競合しても、どちらも空欄しか触らないので安全）
async function patchRow(cacheKey, words) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ words, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`PATCH HTTP ${res.status}: ${await res.text()}`);
}

async function main() {
  console.log(`example_ja backfill（v${VERSION}・${APPLY ? '★実行' : 'dry-run'}）`);
  const rows = await sbGet(
    `vocab_cache?cache_version=eq.${VERSION}&select=cache_key,tmdb_id,season,episode,display_title,words&order=updated_at.asc`
  );
  const targets = rows.filter((r) => (r.words || []).some((w) => w?.example && !w.example_ja));
  let totalMissing = 0;
  for (const r of targets) {
    const n = r.words.filter((w) => w?.example && !w.example_ja).length;
    totalMissing += n;
    console.log(`  ${r.cache_key.padEnd(22)} 空欄 ${String(n).padStart(4)} / ${String(r.words.length).padStart(4)}  ${r.display_title || ''}`);
  }
  console.log(`対象 ${targets.length} 行・空欄 ${totalMissing} 語`);
  if (!APPLY) {
    console.log('dry-run のため API 呼び出しなし。実行するには --apply を付ける。');
    return;
  }

  let batches = 0;
  let filled = 0;
  for (const r of targets) {
    const type = r.season === 0 && r.episode === 0 ? 'movie' : 'tv';
    const ctx = { tmdbId: r.tmdb_id, season: r.season, episode: r.episode, type };
    const bySentence = new Map();
    for (const w of r.words) {
      if (!w?.example || w.example_ja) continue;
      const k = keyOf(w.example);
      if (!bySentence.has(k)) bySentence.set(k, []);
      bySentence.get(k).push(w);
    }
    const sentences = [...bySentence.keys()];
    let rowFilled = 0;
    for (let i = 0; i < sentences.length; i += BATCH) {
      if (MAX_BATCHES && batches >= MAX_BATCHES) break;
      const batch = sentences.slice(i, i + BATCH);
      let res;
      for (let attempt = 0; attempt < 5; attempt++) {
        res = await translateSentences({ sentences: batch, ...ctx });
        if (!res.rateLimited) break;
        console.log('  … 429 rate limited → 65 秒待機');
        await sleep(65000);
      }
      batches++;
      if (res.unsupported) {
        console.error('✖ 本番サーバが mode:\'sentences\' 未対応（デプロイ前？）→ 中止');
        return;
      }
      batch.forEach((s, j) => {
        const ja = res.ja?.[j];
        if (!ja) return;
        for (const w of bySentence.get(s)) {
          if (!w.example_ja) {
            w.example_ja = ja;
            rowFilled++;
          }
        }
      });
    }
    if (rowFilled) {
      await patchRow(r.cache_key, r.words);
      filled += rowFilled;
    }
    const left = r.words.filter((w) => w?.example && !w.example_ja).length;
    console.log(`  ✅ ${r.cache_key.padEnd(22)} +${rowFilled} 語（残り空欄 ${left}）`);
    if (MAX_BATCHES && batches >= MAX_BATCHES) {
      console.log(`  ⏸ --max-batches=${MAX_BATCHES} に到達。残りは再実行で続きから（冪等）`);
      break;
    }
  }
  console.log(`\n完了: ${batches} バッチ・${filled} 語を追記`);
}

main().catch((err) => {
  console.error('✖', err.message);
  process.exit(1);
});
