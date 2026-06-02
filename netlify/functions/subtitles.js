'use strict';

const OS_BASE = 'https://api.opensubtitles.com/api/v1';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const headers = {
    'Api-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'CineLearn v1.0',
  };

  // action: 'search' | 'download'
  if (body.action === 'search') {
    const params = new URLSearchParams({
      query: body.query,
      season_number: body.season,
      episode_number: body.episode,
      languages: 'en',
    });
    const res = await fetch(`${OS_BASE}/subtitles?${params}`, { headers });
    const data = await res.json();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  }

  if (body.action === 'download') {
    const res = await fetch(`${OS_BASE}/download`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file_id: body.fileId }),
    });
    const data = await res.json();

    // SRT ファイルを取得してそのまま返す
    if (data.link) {
      const srtRes = await fetch(data.link);
      const srtText = await srtRes.text();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: srtText,
      };
    }

    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action' }) };
};
