// 字幕マーカー用の語リスト（拡張 v1.2.9〜）。
//   拡張は「いま観ている作品の自動生成リストの語」を字幕の中で淡いクリーム色にするため、語の文字列だけが要る。
//   拡張は TMDB ID を持たない（画面の作品名だけ）ので、ここで作品名→ID を解決し vocab_cache を引いて
//   語の文字列配列だけを返す（定義・例文・レベルは配らない＝最小限の配信）。
//   読み取り専用。キャッシュ未生成（miss）でも**生成は起動しない**（視聴のたびに AI 費用が出るのを避ける）。
//   /api/vocab と同じく、カタログゲート有効時はカタログ外を { found:false, reason:'blocked' } で返す。
// found:false には必ず reason を添える（/api/example と同じ診断方針）。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { checkRateLimit } from '@/lib/ratelimit';
import { resolveTmdbId } from '@/lib/server/tmdbResolve';
import { vocabCacheKey, readVocabRow, isInCatalog, wordStrings } from '@/lib/server/vocabCache';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ found: false, reason: 'forbidden' }, 403);

  // 作品名→TMDB 検索（外部 API）を誘発する経路。拡張は作品/話ごとに1回＋ローカル保持なので、
  // 1端末あたり分60・時300で十分（/api/example の perMin:60 と同水準）。
  if (!(await checkRateLimit(req, 'vocab-marks', { perMin: 60, perHour: 300 })).ok) {
    return json({ found: false, reason: 'rate_limited' }, 429);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    return json({ found: false, reason: 'bad_request' });
  }

  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) return json({ found: false, reason: 'missing_params' });

  // S/E がある＝TV、無い＝映画扱い（/api/example と同じ規則）
  const hasSE =
    body.season != null && body.season !== '' && body.episode != null && body.episode !== '';
  const isMovie = !hasSE;
  const type = isMovie ? 'movie' : 'tv';

  const id = await resolveTmdbId(title, isMovie);
  if (!id) return json({ found: false, reason: 'tmdb_unresolved', type });

  const cacheKey = vocabCacheKey(id, type, hasSE ? Number(body.season) : 0, hasSE ? Number(body.episode) : 0);
  if (!cacheKey) return json({ found: false, reason: 'bad_request', type });

  if (!(await isInCatalog(id))) return json({ found: false, reason: 'blocked', tmdbId: id, type });

  const q = await readVocabRow(cacheKey);
  if (!q.ok) return json({ found: false, reason: 'unavailable', tmdbId: id, type }, 503);
  if (!q.row) return json({ found: false, reason: 'miss', tmdbId: id, type });

  return json({ found: true, tmdbId: id, type, words: wordStrings(q.row.words) });
}
