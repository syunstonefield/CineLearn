// Web Push 購読（復習リマインダー）。旧 js/app.js の購読フローから移植。
// 公開鍵はクライアント埋め込みで問題ない（VAPID の public 側・秘密鍵はサーバー env のみ）。
// 2026-07-02 鍵ペア新規生成（旧秘密鍵が Vercel で Sensitive＝取り出し不可のため。
// 旧鍵の購読は休眠につき切り捨て・送信時 410 → push-notify が自動削除）。
import { getSession, isLoggedIn } from './supabase';

const VAPID_PUBLIC_KEY =
  'BMJuSqk9uZw0R8lbB2rYB7NAXCOnCxQw_fcKIB_gU4CTLh9n6ys1SVqP_kZKJC2Z6uEAkF03y7H4jHf8Lgv5DHA';

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

// ── 通知を切る・朝／夕方を選ぶ（2026-11-13）。/api/push-subscribe の GET／PATCH／DELETE。 ──
const authJson = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getSession()?.access_token || ''}`,
});
async function currentSubscription() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    return (await reg?.pushManager.getSubscription()) || null;
  } catch {
    return null;
  }
}

// この端末の状態。{ supported, subscribed, morning, evening, prefsReady }
//   prefsReady=false: 朝／夕方を選ぶ列がまだ無い（SQL 前）か、読めなかった＝選ぶ所を出さない。
export async function getPushState() {
  const supported =
    typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  if (!supported) return { supported: false, subscribed: false };
  const sub = await currentSubscription();
  if (!sub || Notification.permission !== 'granted') return { supported, subscribed: false };
  if (!isLoggedIn()) return { supported, subscribed: true, morning: true, evening: true, prefsReady: false };
  try {
    const r = await fetch(`/api/push-subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { headers: authJson(), cache: 'no-store' });
    if (!r.ok) return { supported, subscribed: true, morning: true, evening: true, prefsReady: false };
    const d = await r.json();
    // ブラウザには購読があるがサーバーに無い（別アカウントで登録・古い鍵など）＝受け取っていない扱い
    if (!d.subscribed) return { supported, subscribed: false };
    return { supported, subscribed: true, morning: d.morning, evening: d.evening, prefsReady: true };
  } catch {
    return { supported, subscribed: true, morning: true, evening: true, prefsReady: false };
  }
}

// 朝／夕方を選ぶ。戻り値 { ok, morning, evening } か { ok:false, reason }
export async function setPushPrefs(prefs) {
  const sub = await currentSubscription();
  if (!sub) return { ok: false, reason: 'not_subscribed' };
  try {
    const r = await fetch('/api/push-subscribe', {
      method: 'PATCH',
      headers: authJson(),
      body: JSON.stringify({ endpoint: sub.endpoint, ...prefs }),
    });
    if (!r.ok) return { ok: false, reason: r.status === 409 ? 'not_ready' : 'error' };
    const d = await r.json();
    return { ok: true, morning: d.morning, evening: d.evening };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// この端末の通知を切る: サーバーの購読を消す → ブラウザの購読を解除。サーバーで消せなくても解除は行う
//   （解除した購読は送っても 410 になり、送信側が消す＝届かない）。戻り値 { ok }
export async function disablePushSubscription() {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };
  let serverOk = false;
  try {
    const r = await fetch('/api/push-subscribe', {
      method: 'DELETE',
      headers: authJson(),
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    serverOk = r.ok;
  } catch {
    /* 通信できない時も、ブラウザ側は解除する */
  }
  let localOk = false;
  try {
    localOk = await sub.unsubscribe();
  } catch {
    localOk = false;
  }
  return { ok: localOk || serverOk, serverOk, localOk };
}
