// 復習リマインダーの送信。旧 cine-learn.vercel.app/api/push-notify.js からの移植。
// Vercel Cron から呼ばれる（vercel.json crons / CRON_SECRET 認証）。
//
// morning（朝7時 JST = 22:00 UTC 前日）
//   → srs_data の due_date が今日以前のユーザーに「今日N単語の復習があります」
//     ※ srs_data は 2026-07-02 から next-app が復習のたびに同期する（lib/storage.js reviewWord）。
// evening（夜21時 JST = 12:00 UTC）
//   → 全購読者に「次のエピソードを見る前に復習しませんか？」

export const dynamic = 'force-dynamic';

import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sbFetch(path) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
}

async function sendPush(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // 購読が無効 → Supabase から削除
      await fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
        }
      );
    }
    console.error('push failed:', err.message);
    return false;
  }
}

export async function GET(req) {
  // Cron からのリクエストのみ許可（CRON_SECRET を設定すると Vercel が自動で付与する）
  if (!CRON_SECRET || req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!SUPABASE_SERVICE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({ error: 'server_misconfigured' }, 500);
  }
  webpush.setVapidDetails('mailto:syun.stone.field@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const type = new URL(req.url).searchParams.get('type') || 'morning';

  // ── 朝7時：復習日のユーザーにのみ送信 ───────────────────────────
  if (type === 'morning') {
    const today = new Date().toISOString().slice(0, 10);

    const srsRes = await sbFetch(`/srs_data?due_date=lte.${today}&skipped=eq.false&select=user_id`);
    if (!srsRes.ok) return json({ error: 'srs fetch failed' }, 500);
    const srsRows = await srsRes.json();

    const userIds = [...new Set(srsRows.map((r) => r.user_id))];
    if (userIds.length === 0) return json({ sent: 0, type });

    const subsRes = await sbFetch(
      `/push_subscriptions?user_id=in.(${userIds.join(',')})&select=user_id,endpoint,p256dh,auth`
    );
    if (!subsRes.ok) return json({ error: 'subscriptions fetch failed' }, 500);
    const subscriptions = await subsRes.json();

    const dueCounts = {};
    srsRows.forEach((r) => {
      dueCounts[r.user_id] = (dueCounts[r.user_id] || 0) + 1;
    });

    let sent = 0;
    for (const sub of subscriptions) {
      const count = dueCounts[sub.user_id] || 0;
      const ok = await sendPush(sub, {
        title: '📚 今日の復習があります',
        body: `${count}単語の復習日です！忘れないうちにサクッと復習しよう 💪`,
        url: '/app',
      });
      if (ok) sent++;
    }
    return json({ sent, total: subscriptions.length, type });
  }

  // ── 夜21時：全購読者に送信 ────────────────────────────────────────
  if (type === 'evening') {
    const subsRes = await sbFetch(`/push_subscriptions?select=user_id,endpoint,p256dh,auth`);
    if (!subsRes.ok) return json({ error: 'subscriptions fetch failed' }, 500);
    const subscriptions = await subsRes.json();

    let sent = 0;
    for (const sub of subscriptions) {
      const ok = await sendPush(sub, {
        title: '🎬 次のエピソードを見る前に',
        body: '観る前の3分復習。今夜のセリフが、聞き取れる 📖✨',
        url: '/app',
      });
      if (ok) sent++;
    }
    return json({ sent, total: subscriptions.length, type });
  }

  return json({ error: 'type は morning か evening を指定してください' }, 400);
}
