'use client';

// EXP（アカウント固有の経験値）。予習完了・テスト合格・復習で単語数に応じて貯まる。
// 表示の主役は復習完了画面（獲得＋レベルバー）。ホーム等には出さない（数字を主役にしない方針）。
//
// 不変則（2026-08-08 設計討論で確定）:
//  - 減らない・失効しない・降格なし・リーグなし。
//  - 視聴申告にはEXPを出さない（申告と復習を切り離した直近修正を報酬で再結合しない）。
//  - 連続日数ボーナスも出さない（「切れると損」＝罪悪感UIになる）。
//
// 保存形式 = 日付×端末キーの台帳。スカラー合計を持たない理由:
//   同期のマージ規則で積算カウンタは max を使う（合算だと同期のたびに二重計上・supabase.js参照）。
//   スカラーに max を当てると「PCで100・スマホで80」→ 80が消える。台帳なら
//   同一端末・同一日のエントリは単調増加なのでキー別 max が正しく効き、別端末の増分も消えない。
//   総EXPは全値の合計で導出する（保存しない）。1日1端末1エントリ＝1年でも365件程度。

import { queueStatePush } from './supabase';
import { todayStr } from './storage';
import { getDeviceKey } from './device';

export const EXP_LEDGER_KEY = 'cl_exp_ledger';

// 配点（オーナー確定 2026-08-08）
export const EXP_PER_REVIEW_CARD = 2; // 復習カード1枚
export const EXP_LEARNED_BONUS = 5; // 「覚えた」へ昇格
export const EXP_MASTERED_BONUS = 15; // マスターに到達
export const EXP_PER_PREP_WORD = 1; // 予習ウォークスルー完走＝語数×1
export const EXP_PER_QUIZ_WORD = 2; // テスト合格＝語数×2＋ボーナス
export const EXP_QUIZ_PASS_BONUS = 20;
export const QUIZ_PASS_PCT = 60; // QuizScreen の「よくできました」ライン

// レベル閾値（前半を速く: Lv2は初日で届く・Lv5で2週間前後の想定）
const LEVELS = [0, 100, 300, 700, 1500, 3000, 6000, 12000];

export function loadExpLedger() {
  try {
    const v = JSON.parse(localStorage.getItem(EXP_LEDGER_KEY));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function totalExp(ledger = loadExpLedger()) {
  return Object.values(ledger).reduce((s, n) => s + (Number(n) || 0), 0);
}

// EXPを加算して新しい総EXPを返す。負値・0は無視（EXPは減らない）。
export function addExp(n) {
  const amount = Math.max(0, Math.round(Number(n) || 0));
  if (!amount) return totalExp();
  const ledger = loadExpLedger();
  const k = `${todayStr()}|${getDeviceKey()}`;
  ledger[k] = (Number(ledger[k]) || 0) + amount;
  try {
    localStorage.setItem(EXP_LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    /* プライベートモード等は保存を諦める（表示はメモリ上で成立） */
  }
  queueStatePush(EXP_LEDGER_KEY, 500);
  return totalExp(ledger);
}

// 総EXP→レベル情報。level は 1 始まり。最終レベル到達後は progress=1 で満タン表示。
export function levelInfo(total = totalExp()) {
  let level = 1;
  for (let i = 0; i < LEVELS.length; i++) {
    if (total >= LEVELS[i]) level = i + 1;
  }
  const cur = LEVELS[level - 1];
  const next = level < LEVELS.length ? LEVELS[level] : null;
  return {
    level,
    total,
    next,
    toNext: next != null ? next - total : 0,
    progress: next != null ? Math.min(1, (total - cur) / (next - cur)) : 1,
  };
}

// 復習セッション1回ぶんの獲得量（カード数×2＋昇格ボーナス）
export function expForReviewSession({ cards = 0, learned = 0, mastered = 0 }) {
  return cards * EXP_PER_REVIEW_CARD + learned * EXP_LEARNED_BONUS + mastered * EXP_MASTERED_BONUS;
}
