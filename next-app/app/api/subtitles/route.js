// OpenSubtitles 検索/ダウンロード中継（1ホップ化）。
// 旧 cine-learn.vercel.app/api/subtitles.js からの移植。
// 鍵は cinelearn-next に設定済み。旧 cine-learn への移行期フォールバック（relayLegacy）は撤去した。

export const dynamic = 'force-dynamic';

import { checkRateLimit } from '@/lib/ratelimit';

const OS_BASE = 'https://api.opensubtitles.com/api/v1';

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

// ── OpenSubtitles ログイン（ダウンロード枠 5/日 → VIP 枠 に拡大）──────────
// OPENSUBTITLES_USERNAME / _PASSWORD が設定されていればログインし JWT を付与。
// トークンは約24時間有効。温かいインスタンス間でモジュール変数として使い回す。
// 未設定・ログイン失敗時は匿名（5/日）にフォールバック。
let cachedToken = null;
let tokenExpiry = 0;

async function getAuthToken(apiKey) {
  const username = process.env.OPENSUBTITLES_USERNAME;
  const password = process.env.OPENSUBTITLES_PASSWORD;
  if (!username || !password) return null;

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

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey) return json({ error: 'server_misconfigured' }, 500); // 鍵は設定済みの前提（旧経路フォールバックは撤去）

  // ゲート通過後の枠保護：IP単位 30/分・300/時（Upstash env 未設定なら no-op）。
  if (!(await checkRateLimit(req, 'subtitles')).ok) return json({ error: 'rate_limited' }, 429);

  const { action, query, season, episode, fileId, type, tmdbId } = body;

  const headers = {
    'Api-Key': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'CineLearn v1.0',
  };

  if (action === 'search') {
    // 映画は type=movie（tmdb_id があれば厳密検索）。TVは season/episode で検索。
    const params = new URLSearchParams({ languages: 'en' });
    if (type === 'movie') {
      params.set('type', 'movie');
      if (tmdbId) params.set('tmdb_id', tmdbId);
      else params.set('query', query);
    } else if (tmdbId) {
      // TVは parent_tmdb_id ＋話数で厳密検索（タイトル文字列クエリだと日本語題
      // 「マンダロリアン」等が英語字幕DBに一致せず全滅する・2026-07-03実測）。
      params.set('parent_tmdb_id', tmdbId);
      params.set('season_number', season);
      params.set('episode_number', episode);
    } else {
      params.set('query', query);
      params.set('season_number', season);
      params.set('episode_number', episode);
    }
    const r = await fetch(`${OS_BASE}/subtitles?${params}`, { headers });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (action === 'download') {
    // ログイン済みなら Authorization を付けて拡大枠を使う（未設定なら匿名 5/日）
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
      return new Response(srtText, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
      });
    }
    return json(data, r.status);
  }

  return json({ error: 'Invalid action' }, 400);
}
