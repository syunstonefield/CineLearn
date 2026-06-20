// テーマ（ライト/ダーク）管理。
// 保存値 cl_theme: 'dark' | 'light' | 未設定(=システム追従)。
// 実際の適用は <html data-theme="..."> で、CSS の html[data-theme="dark"] が色変数を上書きする。
const KEY = 'cl_theme';

export function getThemePref() {
  try {
    return localStorage.getItem(KEY) || 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function applyTheme(pref = getThemePref()) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolveTheme(pref);
}

export function setThemePref(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  applyTheme(pref);
}
