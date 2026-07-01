// Web Push 購読の保存。旧 cine-learn.vercel.app/api/push-subscribe.js からの移植＋改良。
// 改良点: user_id をクライアント申告制 → JWT（Authorization ヘッダ）からサーバー側で解決。
// push_subscriptions は RLS "service role only" のため書込は SUPABASE_SERVICE_ROLE_KEY で行う。

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 正規アプリ（next-app / localhost / 拡張）からの呼び出しのみ許可。
function allowedOrigin(req) {
  const s = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!s) return true;
  if (s.startsWith('chrome-extension://')) return true;
  try {
    const u = new URL(s);
    const selfHost = req.headers.get('host') || '';
    if (selfHost && u.host === selfHost) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return ['cinelearn-next.vercel.app'].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (!SUPABASE_SERVICE_KEY) return json({ error: 'server_misconfigured' }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const { subscription } = body || {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return json({ error: 'subscription が必要です' }, 400);
  }

  // JWT からユーザーを解決（クライアントの user_id 申告は信用しない）。
  const auth = req.headers.get('authorization') || '';
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!userRes.ok) return json({ error: 'unauthorized' }, 401);
  const user = await userRes.json();
  if (!user?.id) return json({ error: 'unauthorized' }, 401);

  const r = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) return json({ error: await r.text() }, 500);
  return json({ ok: true });
}
