'use strict';

const TMDB_BASE = 'https://api.themoviedb.org/3';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'TMDB_API_KEY not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action, query, tvId } = body;

  // ── TV番組を検索してIDを取得 ──
  if (action === 'search') {
    const res = await fetch(
      `${TMDB_BASE}/search/tv?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=ja-JP`
    );
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  }

  // ── TV番組のシーズン・エピソード情報を取得 ──
  if (action === 'seasons') {
    const res = await fetch(
      `${TMDB_BASE}/tv/${tvId}?api_key=${apiKey}&language=ja-JP`
    );
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action' }) };
};
