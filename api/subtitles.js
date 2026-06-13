import { isAllowedOrigin } from './_origin.js';

const OS_BASE = 'https://api.opensubtitles.com/api/v1';

// ── OpenSubtitles ログイン（ダウンロード枠を 5/日 → 20/日 に拡大）──────────
// 環境変数 OPENSUBTITLES_USERNAME / _PASSWORD が設定されていればログインし、
// JWT トークンを Authorization ヘッダで download に付与する。
// トークンは約24時間有効。Vercel の温かいインスタンス間でモジュール変数として
// 使い回し（ログイン自体はダウンロード枠を消費しないが、無駄打ちは避ける）。
// 認証情報が未設定・ログイン失敗時は従来どおり匿名（5/日）にフォールバックする。
let cachedToken = null;
let tokenExpiry = 0;

async function getAuthToken(apiKey) {
  const username = process.env.OPENSUBTITLES_USERNAME;
  const password = process.env.OPENSUBTITLES_PASSWORD;
  if (!username || !password) return null; // 未設定 → 匿名動作

  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  try {
    const r = await fetch(`${OS_BASE}/login`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json', 'User-Agent': 'CineLearn v1.0' },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      cachedToken = null;
      return null;
    }
    const data = await r.json();
    if (data.token) {
      cachedToken = data.token;
      tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23h（24h失効の手前で更新）
      return cachedToken;
    }
  } catch {
    /* ログイン失敗は匿名フォールバック */
  }
  return null;
}

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
    // ログイン済みなら Authorization を付けて 20/日 枠を使う（未設定なら匿名 5/日）
    const token = await getAuthToken(apiKey);
    const dl = async (tok) => {
      const h = tok ? { ...headers, Authorization: `Bearer ${tok}` } : headers;
      return fetch(`${OS_BASE}/download`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ file_id: fileId }),
      });
    };

    let r = await dl(token);
    // トークン失効（401）時は1回だけ再ログインしてリトライ
    if (r.status === 401 && token) {
      cachedToken = null;
      const fresh = await getAuthToken(apiKey);
      if (fresh) r = await dl(fresh);
    }

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
