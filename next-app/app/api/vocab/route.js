// 共有単語キャッシュの「読み取り専用」エンドポイント（Next.js ルート版）。
// next-app 単体で完結させるため、ルートプロジェクト（api/）側ではなくここに置く。
// /api/vocab は app/api/[...path]/route.js（本番への中継）より優先される
// （Next.js は静的セグメント > キャッチオールの順で解決する）。
//
//   1. カタログ照合（ゲート有効時、カタログ外は { blocked:true }）
//   2. vocab_cache 参照（ヒットでスーパーセットを返す。学習者レベルでの絞り込みはクライアント側）
//   3. ミス/不調/テーブル未作成は { miss:true } を返し、クライアントは従来生成にフォールバック（NFR-4）
// 書き込みは一切しない（シードスクリプト=service_role のみが書く）。
// 公開 anon キーで読む（vocab_cache/catalog は GRANT SELECT + RLS で anon 読み取り可）。

// 常に動的・キャッシュしない（DB の最新状態を毎回反映する）。
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';

// 生成ロジック（プロンプト/モデル）の版。シードスクリプトと一致させること。
const CACHE_VERSION = Number(process.env.VOCAB_CACHE_VERSION || 1);

// カタログゲート。公開時に 'true' でカタログ外を { blocked:true } に。既定は無効（全作品許可）。
const CATALOG_GATE_ENABLED = process.env.CATALOG_GATE_ENABLED === 'true';

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Supabase REST を anon で読む。res.text()+JSON.parse で読み、失敗（テーブル未作成/権限/非JSON）は null。
async function sbSelect(pathWithQuery) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      cache: 'no-store',
    });
    return JSON.parse(await res.text());
  } catch {
    return null; // テーブル未作成/権限/非JSON 等 → 呼び出し側でフォールバック
  }
}

export async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {
    /* 不正ボディは miss 扱い */
  }

  const id = parseInt(body.tmdbId, 10);
  if (!id) return jsonResponse({ miss: true }); // tmdb_id 不明 → 従来生成へ

  const type = body.type;
  const s = Number(body.season) || (type === 'movie' ? 0 : 1);
  const e = Number(body.episode) || (type === 'movie' ? 0 : 1);

  // 1) カタログ照合（enabled な行のみ anon に見える＝RLSポリシー）
  const cat = await sbSelect(`catalog?tmdb_id=eq.${id}&select=tmdb_id&limit=1`);
  const inCatalog = Array.isArray(cat) && cat.length > 0;
  if (CATALOG_GATE_ENABLED && !inCatalog) return jsonResponse({ blocked: true });

  // 2) キャッシュ参照
  const cacheKey = `v${CACHE_VERSION}:tmdb${id}:s${s}e${e}`;
  const rows = await sbSelect(
    `vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}` +
      `&select=words,model,subtitle_provider,coverage_min,coverage_max,word_count&limit=1`
  );
  const row = Array.isArray(rows) && rows[0];
  if (row && Array.isArray(row.words) && row.words.length) {
    return jsonResponse({
      hit: true,
      words: row.words,
      meta: {
        model: row.model,
        provider: row.subtitle_provider,
        coverage: [row.coverage_min, row.coverage_max],
        wordCount: row.word_count,
      },
    });
  }

  return jsonResponse({ miss: true });
}
