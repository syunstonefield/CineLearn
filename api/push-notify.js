'use strict';
/**
 * GET /api/push-notify?type=morning|evening
 * Vercel Cron から呼ばれる。
 *
 * morning（朝7時 JST = 22:00 UTC 前日）
 *   → 復習日のユーザーに「今日N単語の復習があります」を送信
 *
 * evening（夜21時 JST = 12:00 UTC）
 *   → 全購読者に「次のエピソードを見る前に復習しませんか？」を送信
 */

import webpush from 'web-push';

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC_KEY     = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY    = process.env.VAPID_PRIVATE_KEY;
const CRON_SECRET          = process.env.CRON_SECRET;

webpush.setVapidDetails(
  'mailto:syun.stone.field@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
);

async function sbFetch(path) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
}

async function sendPush(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // 購読が無効 → Supabase から削除
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
      });
    }
    console.error('push failed:', err.message);
    return false;
  }
}

export default async function handler(req, res) {
  // Cron からのリクエストのみ許可
  if (req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const type = req.query.type || 'morning';

  // ── 朝7時：復習日のユーザーにのみ送信 ───────────────────────────
  if (type === 'morning') {
    const today = new Date().toISOString().slice(0, 10);

    const srsRes = await sbFetch(
      `/srs_data?due_date=lte.${today}&skipped=eq.false&select=user_id`
    );
    if (!srsRes.ok) return res.status(500).json({ error: 'srs fetch failed' });
    const srsRows = await srsRes.json();

    const userIds = [...new Set(srsRows.map(r => r.user_id))];
    if (userIds.length === 0) return res.status(200).json({ sent: 0, type });

    const subsRes = await sbFetch(
      `/push_subscriptions?user_id=in.(${userIds.join(',')})&select=user_id,endpoint,p256dh,auth`
    );
    if (!subsRes.ok) return res.status(500).json({ error: 'subscriptions fetch failed' });
    const subscriptions = await subsRes.json();

    const dueCounts = {};
    srsRows.forEach(r => {
      dueCounts[r.user_id] = (dueCounts[r.user_id] || 0) + 1;
    });

    let sent = 0;
    for (const sub of subscriptions) {
      const count = dueCounts[sub.user_id] || 0;
      const ok = await sendPush(sub, {
        title: '📚 今日の復習があります',
        body:  `${count}単語の復習日です！忘れないうちにサクッと復習しよう 💪`,
        url:   '/',
      });
      if (ok) sent++;
    }
    return res.status(200).json({ sent, total: subscriptions.length, type });
  }

  // ── 夜21時：全購読者に送信 ────────────────────────────────────────
  if (type === 'evening') {
    const subsRes = await sbFetch(
      `/push_subscriptions?select=user_id,endpoint,p256dh,auth`
    );
    if (!subsRes.ok) return res.status(500).json({ error: 'subscriptions fetch failed' });
    const subscriptions = await subsRes.json();

    let sent = 0;
    for (const sub of subscriptions) {
      const ok = await sendPush(sub, {
        title: '🎬 次のエピソードを見る前に',
        body:  '単語を復習してからドラマを楽しもう！学習効果が2倍に 📖✨',
        url:   '/',
      });
      if (ok) sent++;
    }
    return res.status(200).json({ sent, total: subscriptions.length, type });
  }

  return res.status(400).json({ error: 'type は morning か evening を指定してください' });
}
