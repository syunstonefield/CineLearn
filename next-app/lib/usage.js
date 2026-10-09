'use client';

// ベータの利用データ（2026-10-09 オーナーと設計・docs/design-usage-stats-2026-10-09.md）。
//   端末の中で「その日の回数」をため、画面を閉じる時（タブが隠れた時）と1時間おきに「その日の合計」を
//   /api/usage へ送る（上書き＝何回送っても二重に数えない・送り損ねても次で追いつく）。
//   * 項目の名前は lib/usageEvents.js の一覧だけ。作品名・話の番号・単語は送らない。
//   * 設定「利用統計を送らない」（cl_usage_optout）の間は、ためるのも送るのも止める。この端末だけの設定。
//   * 毎日の復習の語数（初めて／継続／期日が来て残った）は送る直前に端末の SRS から数える。
//     firstReview は端末にしか無い＝端末ごとの数（無料の1日20語の数え方と同じ）。

import { authHeaders } from './api';
import { getDeviceKey } from './device';
import { loadSrs, todayStr, isDue } from './storage';
import { isUsageEvent } from './usageEvents';

const TALLY_KEY = 'cl_usage_tally';
export const USAGE_OPTOUT_KEY = 'cl_usage_optout';
const FLUSH_EVERY_MS = 60 * 60 * 1000;

export function usageOptedOut() {
  try {
    return localStorage.getItem(USAGE_OPTOUT_KEY) === '1';
  } catch {
    return true; // 保存できない環境では送らない
  }
}
export function setUsageOptOut(off) {
  try {
    if (off) {
      localStorage.setItem(USAGE_OPTOUT_KEY, '1');
      localStorage.removeItem(TALLY_KEY);
    } else {
      localStorage.removeItem(USAGE_OPTOUT_KEY);
    }
  } catch {}
}

function loadTally() {
  try {
    const t = JSON.parse(localStorage.getItem(TALLY_KEY) || 'null');
    if (t && typeof t.day === 'string' && t.c && typeof t.c === 'object') return t;
  } catch {}
  return null;
}
function saveTally(t) {
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify(t));
  } catch {}
}

// 今日の復習の語数（端末の SRS から）。
export function reviewNumbers(srs = loadSrs(), today = todayStr()) {
  let n = 0;
  let c = 0;
  let l = 0;
  for (const e of Object.values(srs || {})) {
    if (!e) continue;
    if (e.firstReview === today) n++;
    else if (e.lastReview === today) c++;
    if (e.lastReview !== today && isDue(e)) l++;
  }
  return { n, c, l };
}

function send(t, { keepalive = false } = {}) {
  const body = JSON.stringify({ day: t.day, device: getDeviceKey(), c: t.c, r: t.r || undefined });
  return fetch('/api/usage', { method: 'POST', headers: authHeaders(), body, keepalive, cache: 'no-store' })
    .then((r) => r.ok || r.status === 400 || r.status === 413) // 400/413 は送り直しても同じ＝送れた扱い
    .catch(() => false);
}

// 日付が変わっていたら前の日の分を送ってから今日の分を始める。
function currentTally() {
  const today = todayStr();
  const t = loadTally();
  if (t && t.day === today) return t;
  if (t && t.dirty) send(t, { keepalive: true });
  return { day: today, c: {}, dirty: false, v: 0 };
}

export function trackUsage(name, n = 1) {
  if (typeof window === 'undefined' || usageOptedOut() || !isUsageEvent(name)) return;
  const t = currentTally();
  t.c[name] = (t.c[name] || 0) + n;
  t.dirty = true;
  t.v = (t.v || 0) + 1;
  saveTally(t);
}

let flushing = false;
export async function flushUsage({ keepalive = false } = {}) {
  if (typeof window === 'undefined' || usageOptedOut() || flushing) return;
  const t = currentTally();
  try {
    t.r = reviewNumbers();
  } catch {}
  const prevR = loadTally()?.r;
  const rChanged = JSON.stringify(prevR || null) !== JSON.stringify(t.r || null);
  if (!t.dirty && !rChanged) return;
  saveTally({ ...t, dirty: true });
  flushing = true;
  try {
    const v = t.v;
    if (await send(t, { keepalive })) {
      const now = loadTally();
      if (now && now.day === t.day && now.v === v) saveTally({ ...now, dirty: false });
    }
  } finally {
    flushing = false;
  }
}

// アプリの起動時に1回（AppProvider）。開いた回数を数え、送るきっかけを仕掛ける。戻り値＝後片付け。
export function initUsage() {
  if (typeof window === 'undefined') return () => {};
  trackUsage('open');
  const onVis = () => {
    if (document.visibilityState === 'hidden') flushUsage({ keepalive: true });
  };
  const onHide = () => flushUsage({ keepalive: true });
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
  const timer = setInterval(() => flushUsage(), FLUSH_EVERY_MS);
  const first = setTimeout(() => flushUsage(), 15000); // 開いてすぐ閉じない人の分を早めに
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pagehide', onHide);
    clearInterval(timer);
    clearTimeout(first);
  };
}
