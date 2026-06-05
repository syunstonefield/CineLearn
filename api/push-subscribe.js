'use strict';
/**
 * POST /api/push-subscribe
 * ブラウザからの購読情報を Supabase に保存する
 */

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // RLS をバイパスするため

async function sbFetch(path, options = {}) {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
      ...(options.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { subscription, user_id } = req.body;

  if (!subscription || !user_id) {
    return res.status(400).json({ error: 'subscription と user_id が必要です' });
  }

  const r = await sbFetch('/push_subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      user_id,
      endpoint:   subscription.endpoint,
      p256dh:     subscription.keys.p256dh,
      auth:       subscription.keys.auth,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    return res.status(500).json({ error: err });
  }

  return res.status(200).json({ ok: true });
}
