// Web Push 購読（復習リマインダー）。旧 js/app.js の購読フローから移植。
// 公開鍵はクライアント埋め込みで問題ない（VAPID の public 側・秘密鍵はサーバー env のみ）。
import { getSession, isLoggedIn } from './supabase';

const VAPID_PUBLIC_KEY =
  'BDvzao62EPn3UHluB_1UgyWnnmVyX3BGwnLg7q-TyfHYkQYRC0sAC4HU0bsLAAABQ_FfQkwvWRWLJRATiDuAslk';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// 通知許可 → SW 購読 → サーバー保存 まで。戻り値 { ok, reason }。
// reason: 'unsupported' | 'not_logged_in' | 'denied' | 'save_failed' | 'error'
export async function enablePushSubscription() {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return { ok: false, reason: 'unsupported' };
  }
  // 購読はユーザー単位でサーバー保存する（cron が user_id で srs_data と突き合わせる）ためログイン必須。
  if (!isLoggedIn()) return { ok: false, reason: 'not_logged_in' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    // user_id はサーバーが JWT から解決する（クライアント申告にしない＝他人の購読を汚染できない）。
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getSession()?.access_token || ''}`,
      },
      body: JSON.stringify({ subscription }),
    });
    if (!res.ok) return { ok: false, reason: 'save_failed' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
