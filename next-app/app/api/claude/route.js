// 単語生成・クイズ生成用の Claude 中継（1ホップ化）。
// 旧 cine-learn.vercel.app/api/claude.js からの移植。従来は [...path] の catch-all が
// 旧バックエンドへ2ホップ中継していた（cold 実測 1.27s）。専用 route は catch-all より
// 優先されるため、このファイルの存在だけで /api/claude は1ホップになる。
// ANTHROPIC_API_KEY 未設定の間は relayLegacy で旧経路へフォールバック（移行期の安全弁）。

export const dynamic = 'force-dynamic';

import { checkRateLimit } from '@/lib/ratelimit';
import { relayLegacy } from '@/lib/legacy-relay';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 正規アプリ（next-app / cine-learn / localhost / 拡張）からの呼び出しのみ許可。
function allowedOrigin(req) {
  const s = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!s) return true; // 同一オリジン fetch や拡張 background で origin 無しのことがある
  if (s.startsWith('chrome-extension://')) return true;
  try {
    const u = new URL(s);
    const selfHost = req.headers.get('host') || '';
    if (selfHost && u.host === selfHost) return true; // 同一オリジン（LAN IP実機/各デプロイURL）
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true; // 開発
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return relayLegacy('claude', body); // 鍵未設定 → 旧経路（移行期のみ）

  // ゲート通過後の課金天井：IP単位 30/分・300/時（Upstash env 未設定なら no-op）。
  if (!(await checkRateLimit(req, 'claude')).ok) return json({ error: 'rate_limited' }, 429);

  const { prompt, maxTokens = 2000 } = body;
  if (!prompt) return json({ error: 'prompt is required' }, 400);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
