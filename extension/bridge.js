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
 * v1.2.12 から双方向: 拡張が自分で更新したセッション（同じ人で expires_at が新しい方）をアプリへ戻す。
 * refresh_token は使い捨てなので、戻さないとアプリの更新が already used で失敗しログインが切れていた
 * （2026-11-07 オーナーの PC・裏側の調査）。向きは「新しい方を採る」で決める:
 *   ・同じ人で拡張の方が新しい → アプリの localStorage へ書き戻し、'cl-session-updated' を出す
 *   ・別の人／同じ人でアプリが同じか新しい → アプリの値を拡張へ（別アカウントへの切り替え＝台帳の入れ替え）
 *   ・アプリにセッションが無い（ログアウト後）→ 書き戻さない。ログアウトした瞬間は拡張側も消す
 * アプリの起動処理が古いトークンで更新する前に照合するため document_start で動かす（manifest）。
 *
 * 同一タブ内の書込では storage イベントが発火しないため、軽いポーリングで検知する。
 */

const SESSION_KEY = 'cl_sb_session';
let lastAppRaw = null; // 直前に見たアプリ側の生文字列（ログアウト＝値が消えた瞬間を知るため）

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

const sameTokens = (a, b) => a.access_token === b.access_token && a.refresh_token === b.refresh_token;

async function reconcile() {
  let raw = null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch {
    return; // アクセス不能時は何もしない
  }
  const prevRaw = lastAppRaw;
  lastAppRaw = raw;
  if (raw === null) {
    // Webアプリでログアウト → 拡張側のセッションも破棄（読み込み時に元から無いだけなら何もしない）
    if (prevRaw !== null) chrome.storage.local.remove(SESSION_KEY);
    return;
  }
  let app;
  try {
    app = JSON.parse(raw);
  } catch {
    return; /* 壊れたJSONは送らない */
  }
  if (!isValidSession(app)) return; // 形が違う値も送らない（上の isValidSession）
  const { [SESSION_KEY]: ext } = await chrome.storage.local.get(SESSION_KEY);
  if (isValidSession(ext) && sameTokens(ext, app)) return; // 同じもの
  if (isValidSession(ext) && ext.user.id === app.user.id && ext.expires_at > app.expires_at) {
    // 拡張の方が新しい（拡張が更新した）→ アプリへ戻す。書く直前にアプリ側が変わっていないかを確かめる。
    if (localStorage.getItem(SESSION_KEY) !== raw) return; // 次の照合に任せる
    const next = JSON.stringify(ext);
    localStorage.setItem(SESSION_KEY, next);
    lastAppRaw = next;
    window.dispatchEvent(new Event('cl-session-updated'));
    return;
  }
  chrome.storage.local.set({ [SESSION_KEY]: app });
}

// 同時に走らせない（照合の途中でもう一度呼ばれたら、終わってからもう一周）
let running = false;
let again = false;
async function syncSession() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    await reconcile();
  } catch {
    /* 拡張の更新直後（context invalidated）等は次の同期に任せる */
  } finally {
    running = false;
    if (again) {
      again = false;
      syncSession();
    }
  }
}

// 初回＋他タブでの変更（storageイベント）＋同一タブでの変更（ポーリング）＋拡張がセッションを更新した時
syncSession();
window.addEventListener('storage', (e) => {
  if (e.key === SESSION_KEY || e.key === null) syncSession();
});
setInterval(syncSession, 10 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncSession();
});
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SESSION_KEY]) syncSession();
  });
} catch {
  /* 接続切れ */
}
