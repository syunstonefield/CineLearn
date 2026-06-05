'use strict';
/**
 * CineLearn Bridge - cine-learn.vercel.app 専用コンテンツスクリプト
 *
 * chrome.storage.local の cl_my_words_* 変化を localStorage にコピーし、
 * storage イベントを発火させて app.js に即時通知する。
 */

// 初回起動時：chrome.storage の現在値を localStorage に同期
chrome.storage.local.get(null, (items) => {
  Object.entries(items).forEach(([key, value]) => {
    if (!key.startsWith('cl_my_words')) return;
    try {
      const json = JSON.stringify(value);
      if (localStorage.getItem(key) !== json) {
        localStorage.setItem(key, json);
      }
    } catch {}
  });
});

// 以降：変化があるたびに localStorage を更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  Object.entries(changes).forEach(([key, { newValue }]) => {
    if (!key.startsWith('cl_my_words')) return;
    try {
      if (newValue === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(newValue));
      }
      // app.js の storage イベントリスナーに通知
      // （同タブ内の変更は storage イベントが発火しないため CustomEvent を使う）
      window.dispatchEvent(new CustomEvent('cl_storage_bridge', { detail: { key } }));
    } catch {}
  });
});
