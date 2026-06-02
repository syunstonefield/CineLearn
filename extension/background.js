// CineLearn - Service Worker (background.js)
// 役割：拡張機能アイコンをクリックしたときに CineLearn を新しいタブで開く

chrome.action.onClicked.addListener(() => {
  // chrome-extension://{id}/index.html として開く
  // → この URL では chrome.storage にアクセスできる
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

// インストール時のログ
chrome.runtime.onInstalled.addListener(() => {
  console.log('CineLearn Word Saver がインストールされました');
});
