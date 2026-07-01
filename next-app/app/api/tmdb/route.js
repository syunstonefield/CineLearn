// TMDB 中継（1ホップ化）。旧 cine-learn.vercel.app/api/tmdb.js からの移植。
// 鍵は cinelearn-next に設定済み。旧 cine-learn への移行期フォールバック（relayLegacy）は撤去した。
// レート制限は旧実装同様なし（課金面の優先度低・並列ポスター解決を阻害しないため）。

export const dynamic = 'force-dynamic';

const TMDB_BASE = 'https://api.themoviedb.org/3';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 正規アプリ（next-app / cine-learn / localhost / 拡張）からの呼び出しのみ許可。
function allowedOrigin(req) {
  const s = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!s) return true;
  if (s.startsWith('chrome-extension://')) return true;
  try {
    const u = new URL(s);
    const selfHost = req.headers.get('host') || '';
    if (selfHost && u.host === selfHost) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return ['cinelearn-next.vercel.app', 'cine-learn.vercel.app'].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return json({ error: 'server_misconfigured' }, 500); // 鍵は設定済みの前提（旧経路フォールバックは撤去）

  const { action, query, tvId, movieId, season, episode } = body;

  // エピソード/映画のあらすじ（日本語優先・無ければ英語にフォールバック）
  if (action === 'episode_overview') {
    const path = movieId ? `/movie/${movieId}` : `/tv/${tvId}/season/${season}/episode/${episode}`;
    let r = await fetch(`${TMDB_BASE}${path}?api_key=${apiKey}&language=ja-JP`);
    let data = await r.json();
    if (!data.overview) {
      r = await fetch(`${TMDB_BASE}${path}?api_key=${apiKey}&language=en-US`);
      const en = await r.json();
      if (en.overview) data = en;
    }
    return json({
      overview: data.overview || '',
      name: data.name || data.title || '',
      still_path: data.still_path || data.backdrop_path || null,
    });
  }

  if (action === 'search') {
    const r = await fetch(`${TMDB_BASE}/search/tv?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=ja-JP`);
    return json(await r.json());
  }

  if (action === 'seasons') {
    const r = await fetch(`${TMDB_BASE}/tv/${tvId}?api_key=${apiKey}&language=en-US`);
    return json(await r.json());
  }

  if (action === 'watch_providers') {
    const r = await fetch(`${TMDB_BASE}/tv/${tvId}/watch/providers?api_key=${apiKey}`);
    return json(await r.json());
  }

  // 映画・TVを横断検索（日本語クエリでも localized title が返るよう ja-JP）。
  if (action === 'search_multi') {
    const r = await fetch(`${TMDB_BASE}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=ja-JP`);
    return json(await r.json());
  }

  // 映画：英語タイトルを得るため en-US（クエリは日本語でもマッチする）
  if (action === 'search_movie') {
    const r = await fetch(`${TMDB_BASE}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=en-US`);
    return json(await r.json());
  }

  if (action === 'movie_watch_providers') {
    const r = await fetch(`${TMDB_BASE}/movie/${movieId || tvId}/watch/providers?api_key=${apiKey}`);
    return json(await r.json());
  }

  return json({ error: 'Invalid action' }, 400);
}
