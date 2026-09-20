// 共有単語キャッシュの「読み取り専用」エンドポイント。
//   1. カタログ照合（ゲート有効時、カタログ外は { blocked:true }）
//   2. vocab_cache 参照（ヒットでスーパーセットを返す。学習者レベルでの絞り込みはクライアント側）
//   3. ミス/不調/テーブル未作成は { miss:true }（不調は unavailable:true を添える＝クライアントは1回引き直す）
// 書き込みは一切しない（書き手は /api/vocab-generate（service_role）と seed のみ）。
// 公開 anon キーで読む（vocab_cache/catalog は列指定 GRANT SELECT + RLS で anon 読み取り可）。
// 2026-09-12: キー生成・読取・カタログ照合を lib/server/vocabCache.js に集約し、Origin ゲート（A7）を新設。
//   順序は「ゲート→キャッシュ」（enabled:false＝未審査で非配信の行を直接呼びで配らない・A3 と同じ）。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { vocabCacheKey, readVocabRow, vocabRowMeta, isInCatalog } from '@/lib/server/vocabCache';

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(req) {
  if (!allowedOrigin(req)) return jsonResponse({ error: 'forbidden' }, 403);

  let body = {};
  try {
    body = await req.json();
  } catch {
    /* 不正ボディは miss 扱い */
  }

  const id = parseInt(body.tmdbId, 10);
  if (!id) return jsonResponse({ miss: true }); // tmdb_id 不明 → 従来生成へ

  // 映画は常に s0e0（vocabCacheKey/normalizeEpisode 内で強制。クライアントは S/E 状態値=1 のまま送ってくる）。
  const cacheKey = vocabCacheKey(id, body.type, body.season, body.episode);
  if (!cacheKey) return jsonResponse({ miss: true });

  // 1) カタログ照合（enabled な行のみ anon に見える＝RLS）。照合自体が不調なら弾かない（fail-open）。
  if (!(await isInCatalog(id))) return jsonResponse({ blocked: true });

  // 2) キャッシュ参照
  const q = await readVocabRow(cacheKey);
  if (!q.ok) {
    console.warn('[vocab] shared cache unavailable', cacheKey);
    return jsonResponse({ miss: true, unavailable: true }); // 本当の miss ではない＝クライアントは1回引き直す
  }
  if (q.row) return jsonResponse({ hit: true, words: q.row.words, meta: vocabRowMeta(q.row) });
  return jsonResponse({ miss: true });
}
