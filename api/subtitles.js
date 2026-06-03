const OS_BASE = 'https://api.opensubtitles.com/api/v1';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { action, query, season, episode, fileId } = req.body;

  const headers = {
    'Api-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'CineLearn v1.0',
  };

  if (action === 'search') {
    const params = new URLSearchParams({ query, season_number: season, episode_number: episode, languages: 'en' });
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
