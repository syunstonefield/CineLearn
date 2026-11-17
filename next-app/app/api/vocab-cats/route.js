// 共有キャッシュの語の「意味のカテゴリ」だけを返す読み取り専用のエンドポイント（関連語・2026-11-17）。
//   前に作った history の語に、アプリが後から値を埋めるために使う（送るのは作品と話の番号だけ＝/api/vocab と同じ）。
//   返すのは 語・cat・sub・版 だけ。例文・意味・時刻は返さない。書き込みは一切しない。
//   値はサーバー（生成・seed の後付け）が付けたものだけ。利用者が直した値はここに入らない。
//   2026-11-17: 配信オフの作品でも、共有キャッシュに行がある時は値だけ返す（読むだけ・生成のきっかけにしない）。
//   並びは語の ABC 順・項目は 語・大と小のコード・版だけ。予習・例文・意味の窓口の blocked は変えない。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { checkRateLimit } from '@/lib/ratelimit';
import { vocabCacheKey, readVocabRow } from '@/lib/server/vocabCache';
import { catsOfWords, CAT_VERSION } from '@/lib/relCategories';

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(req) {
  if (!allowedOrigin(req)) return jsonResponse({ error: 'forbidden' }, 403);
  // 端末は1話ずつ・1回の起動で40話まで＝/api/vocab-marks と同じ水準で足りる
  if (!(await checkRateLimit(req, 'vocab-cats', { perMin: 60, perHour: 300 })).ok) return jsonResponse({ error: 'rate_limited' }, 429);
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
  const q = await readVocabRow(cacheKey);
  if (!q.ok) return jsonResponse({ miss: true, unavailable: true });
  if (!q.row) return jsonResponse({ miss: true });
  return jsonResponse({ hit: true, catv: CAT_VERSION, cats: catsOfWords(q.row.words).sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : 0)) });
}
