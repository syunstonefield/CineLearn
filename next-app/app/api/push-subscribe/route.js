// Web Push 購読の保存。旧 cine-learn.vercel.app/api/push-subscribe.js からの移植＋改良。
// 改良点: user_id をクライアント申告制 → JWT（Authorization ヘッダ）からサーバー側で解決。
// push_subscriptions は RLS "service role only" のため書込は SUPABASE_SERVICE_ROLE_KEY で行う。
// 2026-11-13: アプリから通知を切れるように（DELETE＝この端末の購読を消す）・朝／夕方を選べるように（PATCH・GET）。
//   どれも JWT の本人の行（user_id）＋その端末の endpoint だけを触る＝他人の購読は読めない・消せない。
//   朝／夕方の列（morning・evening）が無い DB では GET は両方 true を返し、PATCH は 409（列を足す SQL が先）。

export const dynamic = 'force-dynamic';
import { allowedOrigin } from '@/lib/server/origin'; // 共通 Origin ゲート（A7）

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

// JWT から本人を解決（クライアントの user_id 申告は信用しない）。だめなら null。
async function userFrom(req) {
  const auth = req.headers.get('authorization') || '';
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  return user?.id ? user : null;
}
const svc = (extra = {}) => ({ apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, ...extra });
const okEndpoint = (e) => typeof e === 'string' && /^https:\/\//.test(e) && e.length <= 2000;
const rowPath = (uid, endpoint) =>
  `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(uid)}&endpoint=eq.${encodeURIComponent(endpoint)}`;

// この端末の購読があるか・朝／夕方の選択（?endpoint=）
export async function GET(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (!SUPABASE_SERVICE_KEY) return json({ error: 'server_misconfigured' }, 500);
  const endpoint = new URL(req.url).searchParams.get('endpoint');
  if (!okEndpoint(endpoint)) return json({ error: 'endpoint が必要です' }, 400);
  const user = await userFrom(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const r = await fetch(`${rowPath(user.id, endpoint)}&select=*`, { headers: svc() });
  if (!r.ok) return json({ error: 'fetch failed' }, 500);
  const row = (await r.json())?.[0];
  if (!row) return json({ subscribed: false });
  return json({ subscribed: true, morning: row.morning !== false, evening: row.evening !== false });
}

// 朝／夕方を選ぶ（{ endpoint, morning?, evening? }）
export async function PATCH(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (!SUPABASE_SERVICE_KEY) return json({ error: 'server_misconfigured' }, 500);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const { endpoint } = body || {};
  if (!okEndpoint(endpoint)) return json({ error: 'endpoint が必要です' }, 400);
  const patch = {};
  if (typeof body.morning === 'boolean') patch.morning = body.morning;
  if (typeof body.evening === 'boolean') patch.evening = body.evening;
  if (!Object.keys(patch).length) return json({ error: 'morning か evening が必要です' }, 400);
  const user = await userFrom(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const r = await fetch(rowPath(user.id, endpoint), {
    method: 'PATCH',
    headers: svc({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return json({ error: 'not_ready' }, 409); // 列が無い（SQL が先）など
  const rows = await r.json();
  if (!rows?.length) return json({ error: 'not_found' }, 404);
  return json({ ok: true, morning: rows[0].morning !== false, evening: rows[0].evening !== false });
}

// この端末の購読を消す（{ endpoint }）。行が無くても ok（すでに消えている）。
export async function DELETE(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (!SUPABASE_SERVICE_KEY) return json({ error: 'server_misconfigured' }, 500);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const { endpoint } = body || {};
  if (!okEndpoint(endpoint)) return json({ error: 'endpoint が必要です' }, 400);
  const user = await userFrom(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const r = await fetch(rowPath(user.id, endpoint), { method: 'DELETE', headers: svc() });
  if (!r.ok) return json({ error: 'delete failed' }, 500);
  return json({ ok: true });
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
  const user = await userFrom(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

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
