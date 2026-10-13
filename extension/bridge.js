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

// セッションの形の検証（2026-10-13 セキュリティ監査 Medium「bridge の無検証転写」）。
//   アプリ origin に XSS があると、任意の値（攻撃者のセッション・巨大な値）を localStorage 経由で拡張へ
//   植え込めた。拡張が実際に使う4項目（background.js の access/refresh・期限・uid）の型と大きさだけを見る。
//   1つでも外れたら送らない（壊れた JSON と同じく黙って捨てる）。本筋の対策はアプリ側 CSP。
const TOKEN_MAX = 4096;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidSession(s) {
  const tok = (t) => typeof t === 'string' && t.length > 0 && t.length <= TOKEN_MAX;
  return (
    !!s && typeof s === 'object' &&
    tok(s.access_token) &&
    tok(s.refresh_token) &&
    typeof s.expires_at === 'number' && Number.isFinite(s.expires_at) &&
    !!s.user && typeof s.user === 'object' &&
    typeof s.user.id === 'string' && UUID_RE.test(s.user.id)
  );
}

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
  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return; /* 壊れたJSONは送らない */
  }
  if (!isValidSession(session)) return; // 形が違う値も送らない（上の isValidSession）
  try {
    chrome.storage.local.set({ [SESSION_KEY]: session });
  } catch {
    /* 拡張の更新直後（context invalidated）等は次の同期に任せる */
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
