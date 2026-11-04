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
import { isUsageEvent, hasExtSavedWord } from './usageEvents';
import { takeExtInstallEntry, isExtInstallEntry } from './extEntry';

const TALLY_KEY = 'cl_usage_tally';
const EXT_SEEN_KEY = 'cl_usage_ext_seen'; // 拡張で保存した語を一度でも見た端末（ext_first_save を1回だけにする）
const EXT_ENTRY_COUNTED_KEY = 'cl_usage_ext_entry_counted'; // このタブで ext_install_open を数えた印（sessionStorage）
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

// 拡張で保存した語がこの端末に初めて届いたら ext_first_save を1回（AppProvider がクラウド取込のたびに呼ぶ）。
//   単語帳（cl_my_words）に拡張由来の語があるかだけを見る（語そのものは送らない）。
//   ★既存の利用者が新しい端末でログインした時も1回数える（端末ごとの印のため）＝新規の人の表では
//     「初めて開いた週」で絞るので、この誤差は新規の人の数字には乗りにくい。
export function noteExtWordsOnce() {
  if (typeof window === 'undefined' || usageOptedOut()) return false;
  try {
    if (localStorage.getItem(EXT_SEEN_KEY) === '1') return false;
    const words = JSON.parse(localStorage.getItem('cl_my_words') || '[]');
    if (!hasExtSavedWord(words)) return false;
    localStorage.setItem(EXT_SEEN_KEY, '1');
  } catch {
    return false;
  }
  trackUsage('ext_first_save');
  return true;
}

// 入口の印（/app?from=ext_install・lib/extEntry.js）。タブごとに1回だけ数える。
//   印は URL から読む（takeExtInstallEntry）か、先に別の処理（AppProvider の起動 effect）が sessionStorage へ移して
//   いればそこから読む＝どちらが先に URL を読んでも数え漏れない。数えた印も sessionStorage に置く＝同じタブの
//   再読み込み・別のクエリ付きの開き直しでは数えない（ブックマークは URL の印が消えているので元々数えない）。
//   利用統計を送らない設定でも印は sessionStorage へ移す（画面側が使う）。
function noteEntryParam() {
  const fresh = takeExtInstallEntry();
  if (!fresh && !isExtInstallEntry()) return;
  try {
    if (sessionStorage.getItem(EXT_ENTRY_COUNTED_KEY) === '1') return;
    sessionStorage.setItem(EXT_ENTRY_COUNTED_KEY, '1');
  } catch {
    if (!fresh) return; // sessionStorage が使えない環境では URL から読めた時だけ
  }
  trackUsage('ext_install_open');
}

// アプリの起動時に1回（AppProvider）。開いた回数を数え、送るきっかけを仕掛ける。戻り値＝後片付け。
export function initUsage() {
  if (typeof window === 'undefined') return () => {};
  trackUsage('open');
  noteEntryParam();
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
