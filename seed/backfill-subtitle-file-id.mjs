// 既存の共有リスト（vocab_cache）に、リスト生成に使った字幕ファイル番号を埋め戻す（2026-10-20 /decide D）。
// 正典: docs/decision-manual-example-matching-2026-10-20.md
//
// 埋める元: subtitle_raw_cache.provider（'opensubtitles:<file_id>'）。raw cache は30日で消えるので、今残っている話だけ。
// 条件: raw.fetched_at ≤ vocab.updated_at の行だけ（engineer R1）。リスト生成のあとに手動追加の取り直しで
//   raw が別のファイルに置き換わった行は、その番号がリストを作ったファイルとは限らないので埋めない。
// episode_match は埋めない（当時どの候補が選ばれたかの情報が残っていない＝null のまま）。
// 既に subtitle_file_id がある行は触らない（PATCH の条件に subtitle_file_id=is.null）。
//
// 実行（既定は確認だけ。書き込むのは --apply を付けた時だけ）:
//   node --env-file=seed/.env seed/backfill-subtitle-file-id.mjs
//   node --env-file=seed/.env seed/backfill-subtitle-file-id.mjs --apply
// 前提: supabase_2026-10-20_subtitle_file_id.sql を実行済み（列が無ければ最初の読みで止まる）。
const URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VER = Number(process.env.VOCAB_CACHE_VERSION || 1) || 1;
const APPLY = process.argv.includes('--apply');
if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY がありません（seed/.env）');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function get(q) {
  const r = await fetch(`${URL}/rest/v1/${q}`, { headers: H });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
const fileIdOf = (provider) => {
  const m = /^opensubtitles:(\d+)$/.exec(String(provider || ''));
  return m ? Number(m[1]) : null;
};

const rows = [];
for (let off = 0; ; off += 200) {
  const page = await get(
    `vocab_cache?cache_version=eq.${VER}&select=cache_key,tmdb_id,season,episode,display_title,updated_at,subtitle_file_id&order=cache_key&limit=200&offset=${off}`
  );
  rows.push(...page);
  if (page.length < 200) break;
}
const raws = await get(`subtitle_raw_cache?select=cache_key,tmdb_id,season,episode,provider,fetched_at,expires_at`);
const rawBy = new Map(raws.map((r) => [`${r.tmdb_id}:${r.season}:${r.episode}`, r]));

const stat = { rows: rows.length, alreadySet: 0, noRaw: 0, noFileId: 0, refetchedAfter: 0, toFill: 0, filled: 0, failed: 0 };
const plan = [];
for (const v of rows) {
  if (v.subtitle_file_id) {
    stat.alreadySet++;
    continue;
  }
  const r = rawBy.get(`${v.tmdb_id}:${v.season}:${v.episode}`);
  if (!r) {
    stat.noRaw++;
    continue;
  }
  const fid = fileIdOf(r.provider);
  if (!fid) {
    stat.noFileId++;
    continue;
  }
  if (Date.parse(r.fetched_at) > Date.parse(v.updated_at)) {
    stat.refetchedAfter++;
    continue;
  }
  stat.toFill++;
  plan.push({ cacheKey: v.cache_key, fid, title: v.display_title });
}

for (const p of plan) console.log(`${APPLY ? 'fill' : 'would fill'}  ${p.cacheKey.padEnd(24)} file_id=${p.fid}  ${p.title || ''}`);
if (APPLY) {
  for (const p of plan) {
    const res = await fetch(`${URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(p.cacheKey)}&subtitle_file_id=is.null`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ subtitle_file_id: p.fid }),
    });
    if (res.ok) stat.filled++;
    else {
      stat.failed++;
      console.error('PATCH failed', p.cacheKey, res.status, (await res.text()).slice(0, 120));
    }
  }
}
console.log(JSON.stringify(stat));
if (!APPLY) console.log('（確認だけ。書き込むには --apply）');
