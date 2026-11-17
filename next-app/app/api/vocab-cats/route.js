// 共有キャッシュの語の「意味のカテゴリ」だけを返す読み取り専用のエンドポイント（関連語・2026-11-17）。
//   前に作った history の語に、アプリが後から値を埋めるために使う（送るのは作品と話の番号だけ＝/api/vocab と同じ）。
//   返すのは 語・cat・sub・版 だけ。例文・意味・時刻は返さない。書き込みは一切しない。
//   値はサーバー（生成・seed の後付け）が付けたものだけ。利用者が直した値はここに入らない。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { vocabCacheKey, readVocabRow, isInCatalog } from '@/lib/server/vocabCache';
import { catsOfWords, CAT_VERSION } from '@/lib/relCategories';

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
  if (!id) return jsonResponse({ miss: true });
  const cacheKey = vocabCacheKey(id, body.type, body.season, body.episode);
  if (!cacheKey) return jsonResponse({ miss: true });
  if (!(await isInCatalog(id))) return jsonResponse({ blocked: true });
  const q = await readVocabRow(cacheKey);
  if (!q.ok) return jsonResponse({ miss: true, unavailable: true });
  if (!q.row) return jsonResponse({ miss: true });
  return jsonResponse({ hit: true, catv: CAT_VERSION, cats: catsOfWords(q.row.words) });
}
