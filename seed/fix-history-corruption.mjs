// クラウド history テーブルの「破損行」検出・修復ツール。
//
// 背景:
//   next-app のクラウド同期は pull（読み取り）専用で、履歴をクラウドへ書き戻さない。
//   そのため旧app/過去バグがクラウドに書いた「episode=N なのに中身が別話の単語」という
//   破損行が、毎リロードの pull でローカルに復元され続ける（例: S1E4 を開くと E1 の単語）。
//
// 検出ロジック:
//   同一 user_id・同一 drama.title 内で、words の並びが「より小さい (season,episode) の行」と
//   完全一致する行を「破損（誤コピー）」とみなす。実エピソードが同一語彙になることはないため、
//   完全一致＝誤保存の確実な兆候。小さい話数側を正・大きい話数側を破損として扱う。
//
// 実行（dry-run・既定。削除せず一覧だけ）:
//   node --env-file=seed/.env seed/fix-history-corruption.mjs
// 実際に削除:
//   node --env-file=seed/.env seed/fix-history-corruption.mjs --apply
//
// 前提: history テーブルへ service_role の権限が必要。未付与なら Supabase SQL Editor で:
//   GRANT SELECT, DELETE ON public.history TO service_role;
//
// 任意 env: FIX_TITLE（既定 'Suits'・対象作品名）

const BASE = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TITLE = process.env.FIX_TITLE || 'Suits';
const APPLY = process.argv.includes('--apply');

if (!KEY) {
  console.error('✖ SUPABASE_SERVICE_ROLE_KEY 未設定（seed/.env）。');
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const sig = (ws) => (Array.isArray(ws) ? ws.map((w) => w.word).join('|') : '');
const lower = (a, b) => a.season < b.season || (a.season === b.season && a.episode < b.episode);

async function main() {
  const q =
    '/rest/v1/history?' +
    new URLSearchParams({
      'drama->>title': `eq.${TITLE}`,
      select: 'id,user_id,season,episode,words,updated_at',
      order: 'season.asc,episode.asc',
    }).toString();

  const res = await fetch(BASE + q, { headers, cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text();
    console.error(`✖ read 失敗 HTTP ${res.status}: ${t}`);
    if (res.status === 403) {
      console.error('  → SQL Editor で: GRANT SELECT, DELETE ON public.history TO service_role;');
    }
    process.exit(1);
  }
  const rows = await res.json();
  console.log(`「${TITLE}」cloud history rows: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  S${r.season}E${r.episode}  id=${String(r.id).slice(0, 8)}  uid=${String(r.user_id).slice(0, 8)}  #words=${(r.words || []).length}  first3=[${(r.words || []).slice(0, 3).map((w) => w.word).join(', ')}]`
    );
  }

  // user_id ごとに、より小さい話数と words 完全一致する行＝破損
  const corrupt = [];
  for (const r of rows) {
    const s = sig(r.words);
    if (!s) continue;
    const canonical = rows.find(
      (o) => o.user_id === r.user_id && o.id !== r.id && lower(o, r) && sig(o.words) === s
    );
    if (canonical) corrupt.push({ row: r, canonical });
  }

  if (!corrupt.length) {
    console.log('\n✅ 破損行（別話と単語完全一致）は見つかりませんでした。');
    return;
  }
  console.log(`\n⚠ 破損候補 ${corrupt.length} 件（大きい話数側が誤コピー）:`);
  for (const c of corrupt) {
    console.log(
      `  破損: S${c.row.season}E${c.row.episode} (id=${String(c.row.id).slice(0, 8)})  = 正: S${c.canonical.season}E${c.canonical.episode} の単語と完全一致`
    );
  }

  if (!APPLY) {
    console.log('\n（dry-run）削除するには --apply を付けて再実行してください。');
    return;
  }

  for (const c of corrupt) {
    const del = await fetch(`${BASE}/rest/v1/history?id=eq.${encodeURIComponent(c.row.id)}`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=minimal' },
      cache: 'no-store',
    });
    console.log(`  DELETE S${c.row.season}E${c.row.episode} (id=${String(c.row.id).slice(0, 8)}) → HTTP ${del.status}`);
  }
  console.log('\n✅ 破損行を削除しました。ブラウザでログアウト→再ログイン（または再リロード）で pull が走り、E4 は「未生成（生成を促す）」状態になります。');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
