import { isAllowedOrigin } from './_origin.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'TMDB_API_KEY not configured' });
  }

  const { action, query, tvId, movieId, season, episode } = req.body;

  // エピソード/映画のあらすじ（日本語優先・無ければ英語にフォールバック）
  if (action === 'episode_overview') {
    const path = movieId
      ? `/movie/${movieId}`
      : `/tv/${tvId}/season/${season}/episode/${episode}`;
    let r = await fetch(`${TMDB_BASE}${path}?api_key=${apiKey}&language=ja-JP`);
    let data = await r.json();
    if (!data.overview) {
      r = await fetch(`${TMDB_BASE}${path}?api_key=${apiKey}&language=en-US`);
      const en = await r.json();
      if (en.overview) data = en;
    }
    return res.status(200).json({
      overview: data.overview || '',
      name: data.name || data.title || '',
      // エピソードのスチル画像（映画は backdrop）。利用側が無視しても無害な追加フィールド
      still_path: data.still_path || data.backdrop_path || null,
    });
  }

  if (action === 'search') {
    const r = await fetch(`${TMDB_BASE}/search/tv?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=ja-JP`);
    const data = await r.json();
    return res.status(200).json(data);
  }

  if (action === 'seasons') {
    const r = await fetch(`${TMDB_BASE}/tv/${tvId}?api_key=${apiKey}&language=en-US`);
    const data = await r.json();
    return res.status(200).json(data);
  }

  if (action === 'watch_providers') {
    const r = await fetch(`${TMDB_BASE}/tv/${tvId}/watch/providers?api_key=${apiKey}`);
    const data = await r.json();
    return res.status(200).json(data);
  }

  // 映画・TVを横断検索（人気/関連度順）。type 判定に使う
  if (action === 'search_multi') {
    const r = await fetch(`${TMDB_BASE}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=en-US`);
    const data = await r.json();
    return res.status(200).json(data);
  }

  // ── 映画用 ──────────────────────────────────────────────
  // 英語タイトルを得るため language=en-US で検索（クエリは日本語でもマッチする）
  if (action === 'search_movie') {
    const r = await fetch(`${TMDB_BASE}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=en-US`);
    const data = await r.json();
    return res.status(200).json(data);
  }

  if (action === 'movie_watch_providers') {
    const r = await fetch(`${TMDB_BASE}/movie/${movieId || tvId}/watch/providers?api_key=${apiKey}`);
    const data = await r.json();
    return res.status(200).json(data);
  }

  return res.status(400).json({ error: 'Invalid action' });
}
