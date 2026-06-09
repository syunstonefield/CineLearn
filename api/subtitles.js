import { isAllowedOrigin } from './_origin.js';

const OS_BASE = 'https://api.opensubtitles.com/api/v1';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { action, query, season, episode, fileId, type, tmdbId } = req.body;

  const headers = {
    'Api-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'CineLearn v1.0',
  };

  if (action === 'search') {
    // 映画はシーズン・エピソードを送らず type=movie で検索。
    // tmdb_id があればそれで厳密検索（メイキング/予告編など別作品の混入を防ぐ）。
    // ドラマ（TV）は従来通り season_number / episode_number で検索する。
    const params = new URLSearchParams({ languages: 'en' });
    if (type === 'movie') {
      params.set('type', 'movie');
      if (tmdbId) params.set('tmdb_id', tmdbId);
      else        params.set('query', query);
    } else {
      params.set('query', query);
      params.set('season_number', season);
      params.set('episode_number', episode);
    }
    const r = await fetch(`${OS_BASE}/subtitles?${params}`, { headers });
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  if (action === 'download') {
    const r = await fetch(`${OS_BASE}/download`, {
      method: 'POST', headers,
      body: JSON.stringify({ file_id: fileId }),
    });
    const data = await r.json();
    if (data.link) {
      const srtRes = await fetch(data.link);
      const srtText = await srtRes.text();
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(srtText);
    }
    return res.status(r.status).json(data);
  }

  return res.status(400).json({ error: 'Invalid action' });
}
