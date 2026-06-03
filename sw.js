'use strict';

const CACHE_NAME = 'cinelearn-v3';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ネットワーク優先：常に最新版を取得し、オフライン時だけキャッシュを使う
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API・外部サービスは SW をスルー
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname === 'api.anthropic.com') return;
  if (url.hostname.includes('opensubtitles.com')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
