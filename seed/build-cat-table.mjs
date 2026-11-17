// 「語 → 意味のカテゴリ」の表を作る（関連語の保険・2026-11-17／並びの番号・2026-11-18）。
//   共有キャッシュ（vocab_cache の今の版）の全行を読み、語ごとに1つの値に丸める。
//   丸め方: other 以外で一番多い値（同数なら コードの ABC 順で先）。other しか無い語は other。
//   --order: 小ごとに AI が全語を「意味の近い語が隣り合う」1列に並べ、その番号を足す（'emotion.anger.12'）。
//            AI に渡すのは 指示と、その小の語と CineLearn の日本語の意味だけ（外の辞書・語の一覧は使わない）。
//   表に入れるのは 語・コード・番号だけ（作品・話に結びつけない・語の ABC 順）。DB には書かない（読むだけ）。
//   ★既定は読むだけ（数を出すだけ・ファイルも書かない）。--write の時だけ next-app/public/cat-words.json を書き換える。
//     何度流してもよい（毎回まるごと作り直す）。並べ損ねた小は番号なしで残る（端末は意味の文字の重なりで並べる）。
//   使う所: 端末が値の無い語を埋める（lib/catFill.js）・関連語の並び（lib/related.js の nearSort）。
//   作り直しの時期: 共有キャッシュが増えた時にときどき。新しい語はそれまで番号なし。流したらコミット→デプロイ。
//
// 実行（リポジトリ直下・seed/.env）:
//   node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/build-cat-table.mjs                  # 読むだけ（AI なし）
//   node --env-file=seed/.env --import ./seed/register-hooks.mjs seed/build-cat-table.mjs --order --write  # 並べて書く（約14円）

import { writeFileSync } from 'node:fs';
import { catOf, CAT_VERSION, CAT_OTHER } from '../next-app/lib/relCategories.js';

const args = new Set(process.argv.slice(2));
const ORDER = args.has('--order');
const WRITE = args.has('--write');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERSION = Number(process.env.VOCAB_CACHE_VERSION || 2);
const OUT = new URL('../next-app/public/cat-words.json', import.meta.url);
if (!SERVICE_KEY) {
  console.error('✖ SUPABASE_SERVICE_ROLE_KEY が未設定です（seed/.env）');
  process.exit(1);
}
if (ORDER && !process.env.ANTHROPIC_API_KEY) {
  console.error('✖ ANTHROPIC_API_KEY が未設定です（seed/.env）');
  process.exit(1);
}
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const rows = [];
for (let off = 0; ; off += 100) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/vocab_cache?cache_version=eq.${VERSION}&select=words&order=cache_key&limit=100&offset=${off}`, { headers });
  if (!r.ok) throw new Error(`vocab_cache ${r.status}`);
  const j = await r.json();
  rows.push(...j);
  if (j.length < 100) break;
}

const seen = new Map(); // 語 → { 値: 回数 }
const defs = new Map(); // 語 → { 値: 最初の日本語の意味 }
for (const row of rows) {
  for (const w of row.words || []) {
    const c = catOf(w);
    if (!c || !w.word) continue;
    const k = String(w.word).toLowerCase().trim();
    const v = c.cat === CAT_OTHER ? CAT_OTHER : `${c.cat}.${c.sub}`;
    if (!seen.has(k)) seen.set(k, {}), defs.set(k, {});
    const cnt = seen.get(k);
    cnt[v] = (cnt[v] || 0) + 1;
    if (!defs.get(k)[v] && w.definition) defs.get(k)[v] = String(w.definition);
  }
}
const words = {};
for (const k of [...seen.keys()].sort()) {
  const best = Object.entries(seen.get(k))
    .filter(([v]) => v !== CAT_OTHER)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  words[k] = best ? best[0] : CAT_OTHER;
}

let ordered = 0;
let failed = 0;
let inTok = 0;
let outTok = 0;
if (ORDER) {
  const { callHaiku } = await import('../next-app/lib/server/anthropic.js');
  const { VOCAB_MODEL } = await import('../next-app/lib/server/constants.js');
  const { buildOrderPrompt, parseOrderReply } = await import('../next-app/lib/server/catOrder.js');
  const bySub = new Map();
  for (const [k, v] of Object.entries(words)) {
    if (v === CAT_OTHER) continue;
    if (!bySub.has(v)) bySub.set(v, []);
    bySub.get(v).push({ word: k, definition: defs.get(k)[v] || '' });
  }
  for (const [v, items] of [...bySub.entries()].sort()) {
    const [cat, sub] = v.split('.');
    if (items.length < 2) continue;
    let pos = null;
    try {
      const text = await callHaiku(buildOrderPrompt(cat, sub, items), 2000 + items.length * 30, {
        model: VOCAB_MODEL,
        extra: { output_config: { effort: 'low' } },
        deadlineAt: Date.now() + 180000,
        onUsage: (u) => {
          inTok += u?.input_tokens || 0;
          outTok += u?.output_tokens || 0;
        },
      });
      pos = parseOrderReply(text, items.length);
    } catch {
      pos = null;
    }
    if (!pos) {
      failed++;
      console.warn(`  ✖ ${v}（${items.length}語）並べ損ね＝番号なしで残す`);
      continue;
    }
    items.forEach((it, i) => {
      if (pos[i] !== null) words[it.word] = `${v}.${pos[i]}`;
    });
    ordered++;
    console.log(`  ${v} ${items.length}語`);
  }
}

const body = JSON.stringify({ catv: CAT_VERSION, words });
const usd = (inTok * 0.1 + outTok * 0.5) / 1e6;
console.log(
  `行 ${rows.length}・語 ${Object.keys(words).length}・${body.length} bytes` +
    (ORDER ? `・並べた小 ${ordered}・並べ損ね ${failed}・トークン 入${inTok}/出${outTok}（約 $${usd.toFixed(3)}）` : '') +
    (WRITE ? ' → next-app/public/cat-words.json に書いた' : '・読むだけ（--write で書く）')
);
if (WRITE) writeFileSync(OUT, body + '\n');
