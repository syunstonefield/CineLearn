'use strict';
// CineLearn - Service Worker (background.js)

const SUPABASE_URL      = 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';
const SB_SESSION_KEY    = 'cl_sb_session';

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('CineLearn Word Saver がインストールされました');
});

// content.js からの単語保存メッセージを受け取って Supabase に同期
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SAVE_WORD_TO_CLOUD') {
    syncWordToSupabase(msg.word)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true; // 非同期レスポンスを使うため必須
  }
});

// セッションを有効な状態に保つ（js/supabase.js の ensureFreshSession と同等）。
// アクセストークンは約1時間で失効するため、期限が近ければ refresh_token で
// 自動更新して chrome.storage に書き戻す。これが無いと失効後の単語保存が
// 黙ってクラウド同期されなくなる（単語帳には残るが他端末に届かない）。
let _refreshPromise = null; // 並行リフレッシュ防止（refresh_token は使い捨てのため）

async function getFreshSession() {
  const result  = await chrome.storage.local.get([SB_SESSION_KEY]);
  const session = result[SB_SESSION_KEY];
  if (!session?.access_token) return null;

  const now = Date.now() / 1000;
  if (session.expires_at && session.expires_at - now > 600) return session; // まだ新鮮
  if (!session.refresh_token) return null;

  if (!_refreshPromise) {
    _refreshPromise = (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        });
        const d = await res.json();
        if (!d?.access_token) return null;
        if (!d.expires_at) d.expires_at = Math.floor(Date.now() / 1000) + (d.expires_in || 3600);
        if (!d.user) d.user = session.user; // 応答に user が無い場合は引き継ぐ
        await chrome.storage.local.set({ [SB_SESSION_KEY]: d });
        return d;
      } catch {
        return null;
      } finally {
        _refreshPromise = null;
      }
    })();
  }
  return _refreshPromise;
}

async function syncWordToSupabase(word) {
  const session = await getFreshSession();
  if (!session?.access_token || !session?.user?.id) return;

  await fetch(`${SUPABASE_URL}/rest/v1/my_words`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify([{
      user_id:     session.user.id,
      word:        word.word,
      sentence:    word.sentence    || '',
      phonetic:    word.phonetic    || '',
      pos:         word.pos         || '',
      definition:  word.definition  || '',
      saved_at:    word.savedAt     || '',
      source:      word.source      || '',
      drama_title: word.dramaTitle  || '',
      season:      word.season      ?? null,
      episode:     word.episode     ?? null,
    }]),
  });
}
