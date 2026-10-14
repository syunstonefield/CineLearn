// 字幕マーカー用の語リスト（拡張 v1.2.9〜）。
//   拡張は「いま観ている作品の自動生成リストの語」を字幕の中で淡いクリーム色にするため、語の文字列だけが要る。
//   拡張は TMDB ID を持たない（画面の作品名だけ）ので、ここで作品名→ID を解決し vocab_cache を引いて
//   語＋日本語の意味＋品詞だけを返す（例文・レベル・チャンクは配らない＝最小限の配信。意味は自前の生成文）。
//   読み取り専用。キャッシュ未生成（miss）でも**生成は起動しない**（視聴のたびに AI 費用が出るのを避ける）。
//   カタログゲートは /api/vocab-generate と同じ規則＝**未ログインのみ**（ログイン済みはどの作品でも可。拡張は
//   Authorization: Bearer を添える）。カタログ外の未ログインは { found:false, reason:'blocked' }。
// found:false には必ず reason を添える（/api/example と同じ診断方針）。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { checkRateLimit } from '@/lib/ratelimit';
import { resolveUserId, bearerToken } from '@/lib/server/auth';
import { resolveTmdbId, resolveTmdbIdFromHistory } from '@/lib/server/tmdbResolve';
import { vocabCacheKey, readVocabRow, isInCatalog, wordMeanings, sbSelect } from '@/lib/server/vocabCache';
import { SUPABASE_ANON_KEY } from '@/lib/server/constants';

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

  const auth = await resolveUserId(req);

  // 作品 ID の解決（2026-10-15 根本対策・オーナー承認）:
  //   ① ログイン済みなら、本人がリストを作った作品（history・クラウド同期済み・drama.tmdbId）から
  //      「ゆるい一致」で引く。相手が少数なので表記揺れ（全角記号・副題・「を視聴」）に強い。
  //   ② 外れたら従来の TMDB 検索（NFKC 正規化済み）＝他の人が作った共有リストの作品向け。
  //   ③ それでも外れたら作品名をログに残す（どの表記で落ちたか後から追える）。
  let id = null;
  let via = '';
  const token = bearerToken(req);
  if (auth.uid && token) {
    const h = await sbSelect(
      `history?user_id=eq.${auth.uid}&select=drama,season,episode&order=updated_at.desc&limit=300`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    if (h.ok) {
      id = resolveTmdbIdFromHistory(title, isMovie, h.rows);
      if (id) via = 'history';
    }
  }
  if (!id) {
    id = await resolveTmdbId(title, isMovie);
    if (id) via = 'tmdb';
  }
  if (!id) {
    console.warn('[vocab-marks] tmdb_unresolved', JSON.stringify(title), type, auth.uid ? 'user' : 'anon');
    return json({ found: false, reason: 'tmdb_unresolved', type });
  }

  const cacheKey = vocabCacheKey(id, type, hasSE ? Number(body.season) : 0, hasSE ? Number(body.episode) : 0);
  if (!cacheKey) return json({ found: false, reason: 'bad_request', type });

  // カタログゲート（未ログインのみ・/api/vocab-generate と同じ）。Auth 不調は匿名扱い＝ゲートにかかる
  //（権限は付与しない）が、isInCatalog 自体の不調は fail-open。
  // auth は診断用（none=トークン無し / invalid=失効 / unavailable=Auth不調）。拡張のログで切り分ける。
  if (!auth.uid && !(await isInCatalog(id))) {
    return json({ found: false, reason: 'blocked', auth: auth.reason, tmdbId: id, type });
  }

  const q = await readVocabRow(cacheKey);
  if (!q.ok) return json({ found: false, reason: 'unavailable', tmdbId: id, type }, 503);
  if (!q.row) return json({ found: false, reason: 'miss', tmdbId: id, type });

  // v1.2.9 拡張: words は [{ w, d?, p? }]（語・意味・品詞）。ポップアップがクリック即時に意味を出すため。
  return json({ found: true, tmdbId: id, type, via, words: wordMeanings(q.row.words) });
}
