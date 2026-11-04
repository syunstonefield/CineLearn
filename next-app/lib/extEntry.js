'use client';

// 拡張の導入直後に開く案内タブの印（2026-11-04・Chrome 拡張部門と合わせた形）。
//   拡張は新規インストール時に https://cinelearn-next.vercel.app/app?from=ext_install を開く。
//   アプリは起動時に1回だけ URL の印を読み、sessionStorage（このタブの間だけ）へ移してから
//   history.replaceState で URL から消す（再読み込み・共有・ブックマークで二重に数えない）。
//   * 読んで消すのは lib/usage.js initUsage（利用データ ext_install_open を1回数える）。
//   * 画面側は isExtInstallEntry() で「拡張から来たタブか」を読める（利用統計を送らない設定でも印は残す）。

export const EXT_INSTALL_PARAM = 'from';
export const EXT_INSTALL_VALUE = 'ext_install';
export const EXT_INSTALL_SESSION_KEY = 'cl_ext_install_entry';

// URL に印があれば sessionStorage へ移して URL から消す。印があった（＝今回初めて読んだ）時だけ true。
export function takeExtInstallEntry() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(EXT_INSTALL_PARAM) !== EXT_INSTALL_VALUE) return false;
    url.searchParams.delete(EXT_INSTALL_PARAM);
    try {
      sessionStorage.setItem(EXT_INSTALL_SESSION_KEY, '1');
    } catch {}
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    return true;
  } catch {
    return false;
  }
}

// このタブは拡張の案内から開いたか（takeExtInstallEntry の後・再読み込みしても同じタブなら true）。
export function isExtInstallEntry() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(EXT_INSTALL_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

// 案内を閉じた時に呼ぶ（components/Dashboard.js）。以後このタブでも通常の表示に戻る。
export function clearExtInstallEntry() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(EXT_INSTALL_SESSION_KEY);
  } catch {}
}
