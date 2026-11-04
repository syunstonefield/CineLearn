// 拡張の新規インストールで開いたタブの印（2026-11-04・docs/research-2026-11-new-user-dropoff.md）。
//   extension/background.js が /app?from=ext_install を開く。印はタブの間だけ sessionStorage に移し、
//   URL からは消す（再読み込みや URL の共有で別の人・別の機会に効かないように）。
//   作品名・アカウントなどは含まない。この端末のこのタブの中だけで使う。
const PARAM = 'from';
const VALUE = 'ext_install';
const KEY = 'cl_ext_install_entry';

let memo = false; // sessionStorage が使えない時の控え

function capture() {
  const url = new URL(window.location.href);
  if (url.searchParams.get(PARAM) !== VALUE) return;
  memo = true;
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
  url.searchParams.delete(PARAM);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

// このタブは拡張のインストール直後に開かれたものか。何度呼んでもよい（SSR では false）。
export function isExtInstallEntry() {
  if (typeof window === 'undefined') return false;
  capture();
  if (memo) return true;
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

// 案内を閉じた時に呼ぶ。以後このタブでも通常の表示に戻る。
export function clearExtInstallEntry() {
  memo = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
