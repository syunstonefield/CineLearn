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
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(url);
      } else {
        clients.openWindow(url);
      }
    })
  );
});
