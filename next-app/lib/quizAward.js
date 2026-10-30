'use client';

// 視聴後クイズの EXP（2026-10-30 オーナー判断「1」）。
//  - 答えた問題1つにつき EXP_PER_QUIZ_WORD(2)。答えた瞬間に付ける＝途中でやめても・画面ごと離れても残る。
//  - 同じ話（historyId）の同じ語には1回だけ（台帳 QUIZ_EXP_AWARDED_KEY）。途中→再挑戦→最後まで、
//    「もう一度挑戦する」の連打でも同じ問題に2回付かない。
//  - 合格ボーナス（EXP_QUIZ_PASS_BONUS）は従来どおり「その話の初回合格」だけ（完了時・quizPassBonus）。
//    旧仕様の「合格時に語数×2＋20」は、語数×2 を答えた時点に前倒ししただけで初回の合計は同じ。
//  - 台帳は端末ローカル（同期しない）。別端末で同じ問題を答えると、その端末で1回だけ付く。
import { addExp, EXP_PER_QUIZ_WORD, EXP_QUIZ_PASS_BONUS, QUIZ_PASS_PCT } from './exp';

export const QUIZ_EXP_AWARDED_KEY = 'cl_quiz_exp_awarded';

function loadAwarded() {
  try {
    const v = JSON.parse(localStorage.getItem(QUIZ_EXP_AWARDED_KEY));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// 1問答えた時に呼ぶ。戻り値＝今回付いた EXP（初めての問題なら 2・既に付いた問題なら 0）。
export function awardQuizAnswer(historyId, word) {
  const k = String(word || '').toLowerCase();
  if (!k) return 0;
  const hid = String(historyId || '_');
  const all = loadAwarded();
  const list = Array.isArray(all[hid]) ? all[hid] : [];
  if (list.includes(k)) return 0;
  all[hid] = [...list, k];
  try {
    localStorage.setItem(QUIZ_EXP_AWARDED_KEY, JSON.stringify(all));
  } catch {
    return 0; // 台帳に書けない時は付けない（二重加算を防ぐ側に倒す）
  }
  addExp(EXP_PER_QUIZ_WORD);
  return EXP_PER_QUIZ_WORD;
}

// 最後まで解いた時の合格ボーナス。prevPct＝保存前の履歴スコア（その話の初回合格だけに付ける）。
export function quizPassBonus(pct, prevPct) {
  return pct >= QUIZ_PASS_PCT && !(prevPct >= QUIZ_PASS_PCT) ? EXP_QUIZ_PASS_BONUS : 0;
}
