import { isAllowedOrigin } from './_origin.js';

// 共有単語キャッシュの「読み取り専用」エンドポイント（Phase 0 / A：リーン版）。
//   1. カタログ照合（ゲート有効時、カタログ外は { blocked:true }）
//   2. vocab_cache 参照（ヒットでスーパーセットを返す。学習者レベルでの絞り込みはクライアント側）
//   3. ミス/不調は { miss:true } を返し、クライアントは従来生成にフォールバック（NFR-4）
// 書き込みは一切しない（シードスクリプト=service_role のみが書く。設計 §4.1/§5）。
//
// 読み取りは公開 anon キーで行う（vocab_cache/catalog は GRANT SELECT + RLS で anon 読み取り可）。
// service_role キーはこの関数では使わない（漏洩面を増やさない）。

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';

// 生成ロジック（プロンプト/モデル）の版。シードスクリプトと一致させること。
const CACHE_VERSION = Number(process.env.VOCAB_CACHE_VERSION || 1);

// カタログゲート。Phase 0 公開時に 'true' にすると、カタログ外作品は { blocked:true } を返す。
// それまでは無効（全作品許可・キャッシュ参照のみ）＝既存挙動を壊さない。
const CATALOG_GATE_ENABLED = process.env.CATALOG_GATE_ENABLED === 'true';

async function sbSelect(pathWithQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return null; // テーブル未作成/GRANT未設定(401)等は null → 呼び出し側でフォールバック
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { tmdbId, season, episode, type } = req.body || {};
  const id = parseInt(tmdbId, 10);
  // tmdb_id 不明ならゲートもキャッシュもできない → 従来生成へ
  if (!id) {
    return res.status(200).json({ miss: true });
  }
  const s = Number(season) || (type === 'movie' ? 0 : 1);
  const e = Number(episode) || (type === 'movie' ? 0 : 1);

  // 1) カタログ照合（enabled な行のみ anon に見える＝RLSポリシー）
  let inCatalog = false;
  try {
    const rows = await sbSelect(`catalog?tmdb_id=eq.${id}&select=tmdb_id&limit=1`);
    inCatalog = Array.isArray(rows) && rows.length > 0;
  } catch {
    /* DB 不調はゲートしない（既存挙動を優先） */
  }
  if (CATALOG_GATE_ENABLED && !inCatalog) {
    return res.status(200).json({ blocked: true });
  }

  // 2) キャッシュ参照
  const cacheKey = `v${CACHE_VERSION}:tmdb${id}:s${s}e${e}`;
  try {
    const rows = await sbSelect(
      `vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}` +
        `&select=words,model,subtitle_provider,coverage_min,coverage_max,word_count&limit=1`
    );
    const row = Array.isArray(rows) && rows[0];
    if (row && Array.isArray(row.words) && row.words.length) {
      return res.status(200).json({
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
  } catch {
    /* キャッシュ不調は miss 扱い */
  }

  return res.status(200).json({ miss: true });
}
