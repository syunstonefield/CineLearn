'use strict';
/**
 * CineLearn Bridge — cinelearn-next.vercel.app 専用コンテンツスクリプト（v1.2.1で反転）
 *
 * 旧bridge（〜v1.2.0）は chrome.storage → 旧アプリ localStorage の転写だったが、
 * 旧アプリ退役（2026-07-02）で不要化。代わりに v1.2.1 からは逆向きの1キーだけを運ぶ:
 *
 *   Webアプリの localStorage `cl_sb_session` → chrome.storage.local
 *
 * これが拡張の Supabase セッションの唯一の入手経路（旧・拡張内ログインページは廃止済み）。
 * 以降の維持は background.js の refresh_token 自動更新が担う。
 * ログアウト（キー消滅）も追従して chrome.storage 側を消す。
 *
 * 同一タブ内の書込では storage イベントが発火しないため、軽いポーリングで検知する。
 */

const SESSION_KEY = 'cl_sb_session';
let lastSent = null; // 直近に chrome.storage へ送った生文字列（重複送信防止）

function syncSession() {
  let raw = null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch {
    return; // アクセス不能時は何もしない
  }
  if (raw === lastSent) return;
  lastSent = raw;

  if (raw === null) {
    // Webアプリでログアウト → 拡張側のセッションも破棄
    chrome.storage.local.remove(SESSION_KEY);
    return;
  }
  try {
    chrome.storage.local.set({ [SESSION_KEY]: JSON.parse(raw) });
  } catch {
    /* 壊れたJSONは送らない */
  }
}

// 初回＋他タブでの変更（storageイベント）＋同一タブでの変更（ポーリング）
syncSession();
window.addEventListener('storage', (e) => {
  if (e.key === SESSION_KEY || e.key === null) syncSession();
});
setInterval(syncSession, 10 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncSession();
});
