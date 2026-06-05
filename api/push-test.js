'use strict';
/**
 * GET /api/push-test?secret=YOUR_CRON_SECRET
 * テスト用：今すぐ全購読者に通知を送る（確認後削除すること）
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

export default async function handler(req, res) {
  // secret パラメータで認証
  if (req.query.secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 全購読者を取得
  const subsRes = await sbFetch('/push_subscriptions?select=user_id,endpoint,p256dh,auth');
  if (!subsRes.ok) {
    const detail = await subsRes.text();
    return res.status(500).json({
      error: 'subscriptions fetch failed',
      status: subsRes.status,
      detail,
      supabase_url: SUPABASE_URL ? '設定済み' : '未設定',
      service_key:  SUPABASE_SERVICE_KEY ? '設定済み' : '未設定',
    });
  }
  const subscriptions = await subsRes.json();

  if (subscriptions.length === 0) {
    return res.status(200).json({ message: '購読者が0人です。通知を有効にしてから試してください。' });
  }

  let sent = 0;
  for (const sub of subscriptions) {
    const payload = JSON.stringify({
      title: '📚 CineLearn — テスト通知',
      body:  '通知のテストです！復習リマインダーが正常に動作しています 🎬',
      url:   '/',
    });
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      console.error('push failed:', err.message);
    }
  }

  return res.status(200).json({ sent, total: subscriptions.length });
}
