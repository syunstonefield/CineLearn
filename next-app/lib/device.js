'use client';

// 端末判定ヘルパー。
// Chrome拡張(unpacked)はデスクトップChromium専用のため、モバイル端末では
// 「拡張機能の入れ方」導線を出さず、予習・復習用の案内に切り替える判断に使う。
// SSR/サーバーでは navigator が無いので false（＝デスクトップ扱い）を返す。
export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(ua)) return true;
  // iPadOS 13+ は UA が "Macintosh" を名乗るため、タッチポイント数で補完判定する。
  if (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
    return true;
  }
  return false;
}

// 端末キー（作品リクエストの1端末1票などの匿名識別に使う・個人情報を含まない乱数）。
// ログインの有無に依らず安定して同じ値を返す。localStorage 不可時は使い捨て値。
export function getDeviceKey() {
  try {
    let k = localStorage.getItem('cl_device_key');
    if (!k) {
      k = 'd_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      localStorage.setItem('cl_device_key', k);
    }
    return k;
  } catch {
    return 'd_anon';
  }
}
