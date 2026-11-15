'use client';

// 通知を押したら今日の復習を開く（2026-11-15 オーナー決定・受付経由）。
//   * 通知の行き先は /app?open=review&n=morning|evening（app/api/push-notify）。アプリがもう開いている時は
//     service worker（public/sw.js）がその窓を前に出して { type:'cl-open', open:'review', n } を送る＝読み込み直さない
//     （以前は navigate で読み込み直していた＝カードの途中が消えた）。
//   * ここは「開きたい」を一時的に覚えるだけ（sessionStorage・このタブの間）。実際に開くのは AppProvider が、
//     ホームなどふつうの画面にいて、カード・案内が重なっていない時に1回だけ。復習する語が無ければホーム。
//     カード・クイズ・案内の途中や、初めての人の流れ（体験・スライド・アンケート）の途中では動かさない＝印を捨てる。
//   * 利用統計は固定名 push_open_morning／push_open_evening の回数だけ（lib/usageEvents.js）。
import { trackUsage } from './usage';

export const PUSH_OPEN_KEY = 'cl_push_open';
const KINDS = ['morning', 'evening'];
const kindOf = (v) => (KINDS.includes(v) ? v : null);

// 開きたい印を覚えて、回数を1回数える（URL から・service worker の知らせから、どちらも同じ）。
export function notePushOpen(kind) {
  const n = kindOf(kind) || 'morning';
  try {
    sessionStorage.setItem(PUSH_OPEN_KEY, n);
  } catch {
    /* 保存できない環境では、この回だけ開けない（ホームのまま） */
  }
  trackUsage(`push_open_${n}`);
  return n;
}

// URL の印（?open=review&n=…）を読んで消す。あった時だけ true。
export function takePushOpenParam() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('open') !== 'review') return false;
    const n = url.searchParams.get('n');
    url.searchParams.delete('open');
    url.searchParams.delete('n');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    notePushOpen(n);
    return true;
  } catch {
    return false;
  }
}

// 覚えた印を取り出して消す（1回だけ）。
export function takePendingPushOpen() {
  try {
    const v = sessionStorage.getItem(PUSH_OPEN_KEY);
    if (v) sessionStorage.removeItem(PUSH_OPEN_KEY);
    return v ? kindOf(v) || 'morning' : null;
  } catch {
    return null;
  }
}
export function hasPendingPushOpen() {
  try {
    return !!sessionStorage.getItem(PUSH_OPEN_KEY);
  } catch {
    return false;
  }
}

// 今いる画面から、通知の行き先（今日の復習）へ移ってよいか。純関数（テスト用）。
//   'go'＝復習タブへ／'home'＝復習する語が無い＝ホームへ／'wait'＝起動の途中（画面が決まるまで待つ）／
//   'drop'＝この回は動かさない（カード・クイズ・案内の途中＝前に出すだけ。あとから急に移ると驚くので待たない／初めての人の流れ）
const BROWSE = ['main', 'search', 'wordbook', 'journey', 'collection', 'settings', 'review-hub', 'vocab'];
export function pushOpenDecision({ screen, busy = false, hasDue = false } = {}) {
  if (screen === 'profile-select') return 'wait';
  if (!BROWSE.includes(screen) || busy) return 'drop';
  return hasDue ? 'go' : 'home';
}
