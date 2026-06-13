// 既存バックエンド（Vercel Functions）への呼び出し。js/app.js から移植。
// next-app では同一オリジンの /api/* を叩く → app/api/[...path]/route.js が
// Origin を付け替えて cine-learn.vercel.app へ中継する。
const API_BASE = '';

// Claude API を呼び出す（過負荷時は最大3回リトライ）
export async function callClaude(prompt, maxTokens = 2000, onRetry = null) {
  const delays = [3000, 6000, 12000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(`${API_BASE}/api/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, maxTokens }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.content[0].text;
    }
    const err = await res.json();
    if ((res.status === 529 || res.status === 429) && attempt < delays.length) {
      const waitSec = delays[attempt] / 1000;
      if (onRetry) onRetry(attempt + 1, waitSec);
      await new Promise((r) => setTimeout(r, delays[attempt]));
      continue;
    }
    throw new Error(err.error?.message || 'APIエラー');
  }
}

// Open Subtitles で字幕を検索する。
// type='movie' の場合は season/episode を送らず、tmdbId があれば厳密検索する
export async function searchSubtitles(title, season, episode, type = 'tv', tmdbId = null) {
  const body = { action: 'search', query: title };
  if (type === 'movie') {
    body.type = 'movie';
    if (tmdbId) body.tmdbId = tmdbId;
  } else {
    body.season = season;
    body.episode = episode;
  }
  const res = await fetch(`${API_BASE}/api/subtitles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('字幕の検索に失敗しました');
  const data = await res.json();
  return data.data;
}

// 字幕ファイルをダウンロードする
export async function downloadSubtitle(fileId) {
  const res = await fetch(`${API_BASE}/api/subtitles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'download', fileId }),
  });
  if (!res.ok) throw new Error('字幕のダウンロードに失敗しました');
  return await res.text();
}

// TMDb API を叩く薄いラッパ（action ごとに body を渡す）
export async function tmdb(body) {
  const res = await fetch(`${API_BASE}/api/tmdb`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
