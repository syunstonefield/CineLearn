// 復習リマインダーの送信。旧 cine-learn.vercel.app/api/push-notify.js からの移植。
// Vercel Cron から呼ばれる（vercel.json crons / CRON_SECRET 認証）。
//
// morning（朝7時 JST = 22:00 UTC 前日）
//   → srs_data の due_date が日本時間の今日以前の語がある人に「今日の復習があります／N語が今日の復習に並んでいます」
//     ※ srs_data は 2026-07-02 から next-app が復習のたびに同期する（lib/storage.js reviewWord）。
//     ※ 2026-11-13: 日付は日本時間で比べる（due_date は端末の日付＝日本時間。UTC だと日本の「きのう」になり
//        今日が復習日の語が数に入っていなかった）。数は人ごとに数える（1回で取ると 1000行で切れていた）。
// evening（夕方17:30 JST = 08:30 UTC・2026-10-09 オーナー要望で 21:00 から変更）
//   → 直近3日に復習か学習の記録がある人だけ（2026-11-13・lib/server/pushPlan.js）。使っていない人には送らない。
// 購読ごとに朝・夕方を選べる（push_subscriptions.morning／evening・列が無い時は両方受け取る扱い）。

export const dynamic = 'force-dynamic';

import webpush from 'web-push';
import { jstDate, recentSince, isRecentlyActive, wantsKind, countFromRange } from '@/lib/server/pushPlan';

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

async function sbFetch(path, extra = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      ...extra,
    },
  });
}
// 行は取らずに数だけ（count=exact の Content-Range）。失敗は null。
async function sbCount(path) {
  const r = await sbFetch(`${path}&limit=1`, { Prefer: 'count=exact' });
  if (!r.ok) return null;
  return countFromRange(r.headers.get('content-range'));
}
// 購読を全部（ページ送り）。列 morning／evening が無い DB でも動くように select=*。
async function allSubscriptions() {
  const out = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const r = await sbFetch(`/push_subscriptions?select=*&order=endpoint&limit=1000&offset=${offset}`);
    if (!r.ok) return null;
    const page = await r.json();
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}
const byUser = (subs) => {
  const m = new Map();
  for (const s of subs) {
    if (!m.has(s.user_id)) m.set(s.user_id, []);
    m.get(s.user_id).push(s);
  }
  return m;
};

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

  // ── 朝7時：日本時間の今日が復習日の語がある人にだけ ─────────────────
  if (type === 'morning') {
    const today = jstDate();
    const subs = await allSubscriptions();
    if (!subs) return json({ error: 'subscriptions fetch failed' }, 500);
    let sent = 0;
    let users = 0;
    for (const [uid, list] of byUser(subs.filter((s) => wantsKind(s, 'morning')))) {
      const count = await sbCount(`/srs_data?user_id=eq.${uid}&due_date=lte.${today}&skipped=eq.false&select=user_id`);
      if (!count) continue; // 0語・数えられなかった時は送らない
      users++;
      for (const sub of list) {
        const ok = await sendPush(sub, {
          title: '今日の復習があります',
          body: `${count}語が今日の復習に並んでいます`,
          url: '/app',
        });
        if (ok) sent++;
      }
    }
    return json({ sent, users, total: subs.length, type, day: today });
  }

  // ── 夕方17:30：直近3日に復習か学習の記録がある人にだけ ──────────────
  if (type === 'evening') {
    const subs = await allSubscriptions();
    if (!subs) return json({ error: 'subscriptions fetch failed' }, 500);
    const since = recentSince();
    let sent = 0;
    let users = 0;
    for (const [uid, list] of byUser(subs.filter((s) => wantsKind(s, 'evening')))) {
      const [srsR, histR] = await Promise.all([
        sbFetch(`/srs_data?user_id=eq.${uid}&last_review=gte.${since.day}&select=last_review&order=last_review.desc&limit=1`),
        sbFetch(`/history?user_id=eq.${uid}&updated_at=gte.${encodeURIComponent(since.iso)}&select=updated_at&order=updated_at.desc&limit=1`),
      ]);
      const lastReview = srsR.ok ? (await srsR.json())?.[0]?.last_review : null;
      const lastHistoryAt = histR.ok ? (await histR.json())?.[0]?.updated_at : null;
      if (!isRecentlyActive({ lastReview, lastHistoryAt })) continue; // 最近使っていない人には送らない（言い方を変えた通知も送らない）
      users++;
      for (const sub of list) {
        const ok = await sendPush(sub, {
          title: '次のエピソードを見る前に',
          body: '観る前に、その話の単語を見返せます',
          url: '/app',
        });
        if (ok) sent++;
      }
    }
    return json({ sent, users, total: subs.length, type, since: since.day });
  }

  return json({ error: 'type は morning か evening を指定してください' }, 400);
}
