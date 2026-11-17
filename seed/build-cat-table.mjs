// 「語 → 意味のカテゴリ」の表を作る（関連語の保険・2026-11-17）。
//   共有キャッシュ（vocab_cache の今の版）の全行を読み、語ごとに1つの値に丸めて next-app/public/cat-words.json に書く。
//   丸め方: other 以外で一番多い値（同数なら コードの ABC 順で先）。other しか無い語は other。
//   表は作品・話に結びつけない（語と コードだけ・語の ABC 順）。読むだけ＝DB には書かない。
//   端末は作品の番号が分からない話・窓口に行が無い話の語をこの表で埋める（lib/catFill.js）。
//   作り直し: 共有キャッシュが増えたら、これを流してコミット→デプロイ（表の中身が変わると端末は TABLE_V が同じでも新しい語だけ埋める）。
//
// 実行（リポジトリ直下）:
//   node --env-file=seed/.env seed/build-cat-table.mjs

import { writeFileSync } from 'node:fs';
import { catOf, CAT_VERSION, CAT_OTHER } from '../next-app/lib/relCategories.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERSION = Number(process.env.VOCAB_CACHE_VERSION || 2);
const OUT = new URL('../next-app/public/cat-words.json', import.meta.url);
if (!SERVICE_KEY) {
  console.error('✖ SUPABASE_SERVICE_ROLE_KEY が未設定です（seed/.env）');
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

const seen = new Map();
for (const row of rows) {
  for (const w of row.words || []) {
    const c = catOf(w);
    if (!c || !w.word) continue;
    const k = String(w.word).toLowerCase().trim();
    const v = c.cat === CAT_OTHER ? CAT_OTHER : `${c.cat}.${c.sub}`;
    if (!seen.has(k)) seen.set(k, {});
    const cnt = seen.get(k);
    cnt[v] = (cnt[v] || 0) + 1;
  }
}
const words = {};
for (const k of [...seen.keys()].sort()) {
  const best = Object.entries(seen.get(k))
    .filter(([v]) => v !== CAT_OTHER)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  words[k] = best ? best[0] : CAT_OTHER;
}
const body = JSON.stringify({ catv: CAT_VERSION, words });
writeFileSync(OUT, body + '\n');
console.log(`行 ${rows.length}・語 ${Object.keys(words).length}・${body.length} bytes → next-app/public/cat-words.json`);
