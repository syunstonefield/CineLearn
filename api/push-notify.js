'use strict';
/**
 * GET /api/push-notify
 * Vercel Cron から毎朝8時に呼ばれる。
 * Supabase の srs_data を調べて「今日が復習日」のユーザーに Web Push 通知を送る。
 */

import webpush from 'web-push';

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC_KEY     = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY    = process.env.VAPID_PRIVATE_KEY;
const CRON_SECRET          = process.env.CRON_SECRET; // 不正リクエスト防止

webpush.setVapidDetails(
  'mailto:your@email.com', // ← 自分のメールアドレスに変更
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

export default async function handler(req, res) {
  // Cron からのリクエストのみ許可
  if (req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = new Date().toISOString().slice(0, 10);

  // 今日が復習日の単語を持つ user_id 一覧を取得
  const srsRes = await sbFetch(
    `/srs_data?due_date=lte.${today}&skipped=eq.false&select=user_id`
  );
  if (!srsRes.ok) return res.status(500).json({ error: 'srs fetch failed' });
  const srsRows = await srsRes.json();

  // 重複を除いたユーザーIDリスト
  const userIds = [...new Set(srsRows.map(r => r.user_id))];
  if (userIds.length === 0) return res.status(200).json({ sent: 0 });

  // 各ユーザーの購読情報を取得
  const subsRes = await sbFetch(
    `/push_subscriptions?user_id=in.(${userIds.join(',')})&select=user_id,endpoint,p256dh,auth`
  );
  if (!subsRes.ok) return res.status(500).json({ error: 'subscriptions fetch failed' });
  const subscriptions = await subsRes.json();

  // 各ユーザーの復習単語数を集計
  const dueCounts = {};
  srsRows.forEach(r => {
    dueCounts[r.user_id] = (dueCounts[r.user_id] || 0) + 1;
  });

  // 通知を送信
  let sent = 0;
  for (const sub of subscriptions) {
    const count = dueCounts[sub.user_id] || 0;
    const payload = JSON.stringify({
      title: '📚 CineLearn — 今日の復習',
      body:  `${count}単語の復習日です！ドラマで覚えた単語を忘れないうちに復習しよう 🎬`,
      url:   '/',
    });

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      // 購読が無効になっていたら Supabase から削除
      if (err.statusCode === 410 || err.statusCode === 404) {
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
          method: 'DELETE',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
        });
      }
      console.error('push failed:', err.message);
    }
  }

  return res.status(200).json({ sent, total: subscriptions.length });
}
