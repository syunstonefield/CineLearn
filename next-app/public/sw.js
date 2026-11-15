// CineLearn Service Worker（push 通知専用・旧 sw.js から push 部分のみ移植）。
// fetch ハンドラは持たない（Next.js のアセット配信・キャッシュ戦略に干渉しないため）。
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// ── Push通知 ──────────────────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  let data = { title: '📚 CineLearn', body: '今日の復習をしよう！', url: '/app' };
  try {
    if (e.data) data = e.data.json();
  } catch {
    /* ペイロード無し・非JSONは既定文言 */
  }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/app';
  // 2026-11-15: アプリがもう開いている時は、その窓を前に出して「今日の復習を開きたい」を知らせる（読み込み直さない＝
  //   カードの途中が消えない・アプリ側 lib/pushOpen.js）。開いていない時は新しく開く（URL の印 ?open=review で同じ所へ）。
  let msg = null;
  try {
    const u = new URL(url, self.location.origin);
    if (u.searchParams.get('open') === 'review') msg = { type: 'cl-open', open: 'review', n: u.searchParams.get('n') || 'morning' };
  } catch {
    msg = null;
  }
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const app = list.find((c) => c.url.startsWith(self.location.origin + '/app'));
      if (app && msg) {
        app.postMessage(msg);
        return app.focus();
      }
      const existing = app || list.find((c) => c.url.startsWith(self.location.origin));
      if (existing) {
        existing.focus();
        return existing.navigate(url);
      }
      return clients.openWindow(url);
    })
  );
});
