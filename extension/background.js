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

async function syncWordToSupabase(word) {
  const result  = await chrome.storage.local.get([SB_SESSION_KEY]);
  const session = result[SB_SESSION_KEY];
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
