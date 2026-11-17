// 共有単語キャッシュ（vocab_cache）の語に「意味のカテゴリ」を後から付ける（関連語・2026-11-17）。
//   ★本番の vocab_cache に書くのは --apply の時だけ（オーナーの OK をもらってから。まず --rows=5 で試す）。
//   既定（dry-run）は読むだけ＝AI で付けた結果を手元の JSON に書き、数だけ表示する。
//
// 実行（リポジトリ直下・seed/.env に ANTHROPIC_API_KEY が要る）:
//   node --env-file=seed/.env seed/backfill-cats.mjs --rows=5 --out=/tmp/cats.json        # 読むだけ（5行）
//   node --env-file=seed/.env seed/backfill-cats.mjs --rows=5 --apply                     # 5行だけ書き戻す
//   node --env-file=seed/.env seed/backfill-cats.mjs --apply                              # 全部
//   任意: --version=2（既定 env VOCAB_CACHE_VERSION||2） --key=<cache_key>（1行だけ）
// 書き戻しは行ごと。読んだ時の updated_at と同じ行だけを書き換える（その間に作り直された行はさわらない）。
// 費用の目安: 9,516語で約 $0.15（Haiku 5.5・effort low）。

import { writeFileSync } from 'node:fs';
import { callHaiku } from '../next-app/lib/server/anthropic.js';
import { VOCAB_MODEL } from '../next-app/lib/server/constants.js';
import { CAT_BATCH, needsCat, buildCatPrompt, parseCatReply } from '../next-app/lib/server/catBackfill.js';
import { CAT_OTHER } from '../next-app/lib/relCategories.js';

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
const ROWS = Number(args.rows || 0);
const OUT = typeof args.out === 'string' ? args.out : null;

if (!SERVICE_KEY) {
  console.error('✖ SUPABASE_SERVICE_ROLE_KEY が未設定です（seed/.env）');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('✖ ANTHROPIC_API_KEY が未設定です（seed/.env に足す）');
  process.exit(1);
}
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function loadRows() {
  const rows = [];
  const filter = typeof args.key === 'string' ? `cache_key=eq.${encodeURIComponent(args.key)}` : `cache_version=eq.${VERSION}`;
  for (let off = 0; ; off += 100) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/vocab_cache?${filter}&select=cache_key,display_title,updated_at,words&order=cache_key&limit=100&offset=${off}`,
      { headers }
    );
    if (!r.ok) throw new Error(`vocab_cache ${r.status}`);
    const j = await r.json();
    rows.push(...j);
    if (j.length < 100 || (ROWS && rows.length >= ROWS)) break;
  }
  return ROWS ? rows.slice(0, ROWS) : rows;
}

let inTok = 0;
let outTok = 0;
async function classify(items) {
  const text = await callHaiku(buildCatPrompt(items), 4000 + items.length * 12, {
    model: VOCAB_MODEL, // Haiku 5.5（生成と同じ。HAIKU_MODEL は 4.5 で effort を受け付けない）
    extra: { output_config: { effort: 'low' } },
    deadlineAt: Date.now() + 120000,
    onUsage: (u) => {
      inTok += u?.input_tokens || 0;
      outTok += u?.output_tokens || 0;
    },
  });
  return parseCatReply(text, items.length);
}

const rows = await loadRows();
console.log(`行 ${rows.length}（v${VERSION}）・${APPLY ? '書き戻す' : '読むだけ'}`);
const result = [];
let tagged = 0;
let other = 0;
let missed = 0;
let written = 0;
for (const row of rows) {
  const words = Array.isArray(row.words) ? row.words.map((w) => ({ ...w })) : [];
  const todo = words.filter(needsCat);
  for (let i = 0; i < todo.length; i += CAT_BATCH) {
    const part = todo.slice(i, i + CAT_BATCH);
    const got = await classify(part);
    part.forEach((w, j) => {
      if (!got[j]) return missed++;
      Object.assign(w, got[j]);
      if (got[j].cat === CAT_OTHER) other++;
      else tagged++;
    });
  }
  result.push({
    cache_key: row.cache_key,
    title: row.display_title,
    words: words.map((w) => ({ word: w.word, pos: w.pos, definition: w.definition, cat: w.cat || null, sub: w.sub || '' })),
  });
  if (APPLY && todo.length) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(row.cache_key)}&updated_at=eq.${encodeURIComponent(row.updated_at)}`,
      {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ words }),
      }
    );
    const back = r.ok ? await r.json() : [];
    if (r.ok && back.length === 1) written++;
    else console.warn(`  ✖ ${row.cache_key} 書けず（${r.status}・${back.length}行）＝その間に変わった行はさわらない`);
  }
  console.log(`  ${row.cache_key} ${todo.length}語`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 1));
const usd = (inTok * 0.1 + outTok * 0.5) / 1e6;
console.log(`付けた ${tagged}・その他 ${other}・読めず ${missed}・書いた行 ${written}・トークン 入${inTok}/出${outTok}（約 $${usd.toFixed(3)}）`);
