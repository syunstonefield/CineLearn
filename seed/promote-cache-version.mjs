// 共有キャッシュの「版の昇格」スクリプト（v{FROM} の行を v{TO} キーへ複写する・生成なし）。
//
// 背景（2026-09-11 本番実測）: 本番 /api/vocab は VOCAB_CACHE_VERSION=2 で動いているが、
//   seed-vocab.mjs は既定 1 で書いていたため、2026-07-08 にシードした 29 話（新プロンプト製・
//   和訳つき）が本番で一切配信されていなかった。カタログ作品を開いたユーザーは全員が再生成し、
//   和訳なしの v2 行が別に焼き付いていた。生成のやり直しは 'claude' のレート制限（IP 日次 100）
//   を大きく超え、かつ和訳の後埋めが枠切れで空のまま書かれる危険があるため、既存 v1 行を
//   v2 キーへ複写して救う。Claude / OpenSubtitles の消費はゼロ。
//
// 対象: cache_version=FROM かつ subtitle_provider='opensubtitles'（シード製）かつ
//       created_at >= SINCE（既定 2026-07-08 ＝ 固有名詞除外プロンプト 22ec189 以降）かつ
//       同じ tmdb/season/episode の v{TO} 行が無いもの。
//   ※ 旧プロンプト世代（Suits S1 の 2026-06-15 分）と自動寄与行（opensubtitles(auto)）は対象外。
//     版を上げた本来の目的（旧世代の無効化）を尊重する。含めるなら --since=2026-06-01 を明示。
// 既存 v{TO} 行は絶対に上書きしない（ユーザーの履歴と整合している行を守る）。
//
// 実行:
//   node --env-file=seed/.env seed/promote-cache-version.mjs            # dry-run（書き込みなし）
//   node --env-file=seed/.env seed/promote-cache-version.mjs --apply    # 実書き込み
//   オプション: --from=1 --to=2 --since=2026-07-08

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const FROM = Number(args.from || 1);
const TO = Number(args.to || 2);
const SINCE = String(args.since || '2026-07-08');
const APPLY = args.apply === true;

if (!SERVICE_KEY) {
  console.error('✖ SUPABASE_SERVICE_ROLE_KEY が未設定です（seed/.env）');
  process.exit(1);
}
if (!(FROM > 0 && TO > 0 && FROM !== TO)) {
  console.error('✖ --from / --to が不正です');
  process.exit(1);
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function sbGet(pathWithQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, { headers });
  if (!res.ok) throw new Error(`GET ${pathWithQuery.split('?')[0]} HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbInsert(table, rows) {
  // on_conflict 無しの素の INSERT＝既存キーがあれば 409 で失敗する（上書きしない保証を DB 側でも持つ）
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`INSERT ${table} HTTP ${res.status}: ${await res.text()}`);
}

async function main() {
  console.log(`版の昇格 v${FROM} → v${TO}（since ${SINCE}・${APPLY ? '★実書き込み' : 'dry-run'}）`);
  const src = await sbGet(
    `vocab_cache?cache_version=eq.${FROM}&subtitle_provider=eq.opensubtitles&created_at=gte.${SINCE}` +
      `&select=cache_key,tmdb_id,season,episode,display_title,title_norm,words,word_count,coverage_min,coverage_max,subtitle_provider,model,created_at&order=cache_key`
  );
  const dst = await sbGet(`vocab_cache?cache_version=eq.${TO}&select=tmdb_id,season,episode`);
  const exists = new Set(dst.map((r) => `${r.tmdb_id}:${r.season}:${r.episode}`));

  const plan = [];
  for (const r of src) {
    const k = `${r.tmdb_id}:${r.season}:${r.episode}`;
    const newKey = `v${TO}:tmdb${r.tmdb_id}:s${r.season}e${r.episode}`;
    const words = Array.isArray(r.words) ? r.words : [];
    const ja = words.filter((w) => w.example && w.example_ja).length;
    if (exists.has(k)) {
      console.log(`  ⏭ ${r.cache_key.padEnd(22)} → v${TO} 行あり（上書きしない） ${r.display_title}`);
      continue;
    }
    if (words.length < 20) {
      console.log(`  ⚠ ${r.cache_key.padEnd(22)} 語数 ${words.length} < 20 → 見送り ${r.display_title}`);
      continue;
    }
    plan.push({ r, newKey, ja });
    console.log(`  ➜ ${r.cache_key.padEnd(22)} → ${newKey.padEnd(22)} ${String(words.length).padStart(3)}語 / 和訳 ${String(ja).padStart(3)} ${r.display_title}`);
  }
  console.log(`\n複写対象 ${plan.length} 行（元 ${src.length} 行・v${TO} 既存で見送り ${src.length - plan.length} 行）`);
  if (!APPLY) {
    console.log('dry-run のため書き込みなし。実行するには --apply を付ける。');
    return;
  }

  let ok = 0;
  const written = [];
  for (const { r, newKey } of plan) {
    const row = {
      cache_key: newKey,
      cache_version: TO,
      tmdb_id: r.tmdb_id,
      season: r.season,
      episode: r.episode,
      display_title: r.display_title,
      title_norm: r.title_norm,
      words: r.words,
      word_count: r.word_count ?? (Array.isArray(r.words) ? r.words.length : null),
      coverage_min: r.coverage_min,
      coverage_max: r.coverage_max,
      subtitle_provider: r.subtitle_provider,
      model: r.model,
      updated_at: new Date().toISOString(),
    };
    try {
      await sbInsert('vocab_cache', [row]);
      ok++;
      written.push(newKey);
      console.log(`  ✅ ${newKey}`);
    } catch (err) {
      console.error(`  ❌ ${newKey}: ${err.message}`);
    }
  }
  console.log(`\n完了: 書込 ${ok} / ${plan.length}`);
  // ロールバック用にキー一覧を残す（削除は service_role で cache_key=in.(...) の DELETE）
  console.log('written_keys=' + JSON.stringify(written));
}

main().catch((err) => {
  console.error('✖', err.message);
  process.exit(1);
});
