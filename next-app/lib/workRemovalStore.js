'use client';

// コレクションから作品を消去する処理（端末とクラウド）。決め事は lib/workRemoval.js（純関数）。
//   * 消去すると端末の中はすぐ変わる。クラウドへの反映は「元に戻す」の時間（8秒）が過ぎてから
//     （タブを閉じる時はその場で反映）。元に戻すのは端末の中だけで済む（印と円の起点は「戻した」記録を新しく送る＝
//     待ちの間に別の取り込みで印が先にクラウドへ出ていても、新しい方が勝って戻る）。
//   * 別の端末や古いクラウドの行で語が戻ってきても、取り込みのたびに reapplyWorkRemovals がもう一度抜く
//     （消した印は同期する＝どの端末でも同じ作品から同じ語が抜ける）。
//   * 学習した語・SRS・単語帳・拡張の台帳（my_words）・共有の単語リスト（vocab_cache）には触らない。
import {
  HISTORY_KEY,
  loadHistory,
  loadSrs,
  isLearned,
  isMastered,
  loadRemovedWorksMap,
  saveRemovedWorksMap,
  saveRingMetReset,
  loadRingMetReset,
  holdRingMetResetPush,
  loadRemovedWorks,
  collectRingWords,
  ringCounts,
  statsHighWater,
  loadStatsDaily,
  ARCHIVE_EVENT,
} from './storage';
import { pushHistoryEntry, deleteHistoryRow, queueStatePush } from './supabase';
import { getActiveWords, sameWorkTitle } from './words';
import {
  planWorkRemoval,
  withRemoved,
  ringMetValue,
  metAfterRemoval,
  REMOVED_WORKS_KEY,
  RING_MET_RESET_KEY,
} from './workRemoval';

export const UNDO_MS = 8000;

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeRaw(key, raw) {
  try {
    if (raw == null) localStorage.removeItem(key);
    else localStorage.setItem(key, raw);
  } catch {
    /* 容量超過などは諦める */
  }
}
function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ARCHIVE_EVENT));
}

// 確認画面に出す件数（何も変えない）。
export async function previewWorkRemoval(title, profileId) {
  const myWords = await getActiveWords(profileId);
  return planWorkRemoval({ title, history: loadHistory(), myWords, srs: loadSrs(), isLearned, isMastered });
}

function sendRows(plan) {
  // クラウドの history は season/episode が NOT NULL。端末にしか無い古い行（null）は送らない
  //（送ると 400 になり、取り込みのたびに同じ行を送り直すだけになる・裏側レビュー 2026-11-07）。
  plan.rowsUpdate
    .filter((h) => h.season != null && h.episode != null)
    .forEach((h) => pushHistoryEntry(h)); // ログイン時のみ・fire-and-forget
  plan.rowsDelete.forEach((id) => deleteHistoryRow(id));
}

let pending = null; // { title, plan, snapshot, shownMet, profileId, timer }

// 今の円に見えている「出会った」（lib/rings.js settleRingValues と同じ求め方）。
function shownMet(history, myWords, srs) {
  const current = ringCounts(collectRingWords(history, myWords, srs, sameWorkTitle)).met;
  return ringMetValue({ current, highWater: statsHighWater(loadStatsDaily()).met, reset: loadRingMetReset() });
}

function onHide() {
  commitPendingRemoval();
}

// 待っている消去をクラウドへ反映する（8秒が過ぎた・タブを閉じた・次の消去を始めた）。
export function commitPendingRemoval() {
  if (!pending) return;
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
  holdRingMetResetPush(false);
  sendRows(p.plan);
  queueStatePush(REMOVED_WORKS_KEY, 0);
  queueStatePush(RING_MET_RESET_KEY, 0);
  // 待ちの間の取り込みで行が戻っていたら抜き直す（戻っていなければ何もしない）。
  reapplyWorkRemovals(p.profileId)
    .then((n) => n && notify())
    .catch(() => {});
}

// 消去する。戻り値＝計画（件数）。端末の中はすぐ変わり、クラウドは UNDO_MS 後。
export async function removeWork(title, profileId) {
  if (!title) return null;
  commitPendingRemoval();
  const myWords = await getActiveWords(profileId);
  const history = loadHistory();
  const srs = loadSrs();
  const plan = planWorkRemoval({ title, history, myWords, srs, isLearned, isMastered });
  const before = shownMet(history, myWords, srs);
  const snapshot = {
    history: readRaw(HISTORY_KEY),
    removed: readRaw(REMOVED_WORKS_KEY),
    reset: readRaw(RING_MET_RESET_KEY),
  };
  const now = Date.now();
  if (plan.changed) writeRaw(HISTORY_KEY, JSON.stringify(plan.nextHistory));
  saveRemovedWorksMap(withRemoved(loadRemovedWorksMap(), title, true, now), { push: false });
  // 円の「出会った」は消えた語の数だけ減らす（覚えた・マスターは触らない）。
  holdRingMetResetPush(true);
  saveRingMetReset({ at: now, met: metAfterRemoval(before, plan.counts.removed) }, { push: false });
  pending = { title, plan, snapshot, shownMet: before, profileId, timer: setTimeout(commitPendingRemoval, UNDO_MS) };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
  notify();
  return plan;
}

// 元に戻す（UNDO_MS の間だけ）。戻せたら true。
export function undoWorkRemoval() {
  if (!pending) return false;
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
  holdRingMetResetPush(false);
  writeRaw(HISTORY_KEY, p.snapshot.history); // クラウドの行はまだ変えていない
  const now = Date.now();
  writeRaw(REMOVED_WORKS_KEY, p.snapshot.removed);
  saveRemovedWorksMap(withRemoved(loadRemovedWorksMap(), p.title, false, now));
  // 円は消す前に見えていた値へ（新しい起点として残す＝待ちの間に送られた起点より新しいので勝つ）。
  saveRingMetReset({ at: now, met: p.shownMet });
  notify();
  return true;
}

// 取り込みのあと（AppProvider）。消した作品に未学習の語が戻っていたら、もう一度抜いてクラウドも直す。
//   消去の途中（元に戻すの待ち）は触らない。戻り値＝直した作品数。
export async function reapplyWorkRemovals(profileId) {
  if (pending) return 0;
  const titles = loadRemovedWorks();
  if (!titles.length) return 0;
  const myWords = await getActiveWords(profileId);
  let history = loadHistory();
  const srs = loadSrs();
  let fixed = 0;
  for (const title of titles) {
    const plan = planWorkRemoval({ title, history, myWords, srs, isLearned, isMastered });
    if (!plan.changed) continue;
    history = plan.nextHistory;
    sendRows(plan);
    fixed++;
  }
  if (fixed) {
    writeRaw(HISTORY_KEY, JSON.stringify(history));
    notify();
  }
  return fixed;
}
