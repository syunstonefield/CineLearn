'use strict';
/**
 * CineLearn Bridge - cine-learn.vercel.app 専用コンテンツスクリプト
 *
 * chrome.storage.local の対象キー（cl_my_words_* / cl_vodsync_*）の変化を
 * localStorage にコピーし、app.js に即時通知する。
 *   - cl_my_words_*  : マイ単語帳
 *   - cl_vodsync_*   : VOD実時刻アンカー（タイムスタンプ補正用）
 */

// 同期対象のキーか判定
function isBridgedKey(key) {
  return key.startsWith('cl_my_words') || key.startsWith('cl_vodsync_');
}

// 初回起動時：chrome.storage の現在値を localStorage に同期
chrome.storage.local.get(null, (items) => {
  Object.entries(items).forEach(([key, value]) => {
    if (!isBridgedKey(key)) return;
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
    if (!isBridgedKey(key)) return;
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
