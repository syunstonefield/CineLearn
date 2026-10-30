'use client';

// 復習セッション1回ぶんの「記録＋EXP 加算」（2026-10-30）。
// 完了画面（ReviewDone）と、途中でやめた時（✕／ボトムナビ等で抜ける）の両方から同じ関数で付ける。
// 呼ぶ側が1セッション1回に限る（ReviewModal の awardedRef）＝途中→成果画面→✕ の流れでも二重に付かない。
// queue＝採点した語だけ（途中なら queue.slice(0, idx)）。未採点の語は数えない・EXP も付けない。
import { recordReviewSession, getTodaySessions } from './storage';
import { addExp, levelInfo, expForReviewSession } from './exp';

export function tallyRatings(queue, ratings) {
  const failed = queue.filter((w) => ratings[w.word] === 0).length;
  const hard = queue.filter((w) => ratings[w.word] === 3).length;
  return { failed, hard, easy: queue.length - failed - hard };
}

export function awardReviewSession({ queue, ratings, promo, historyId }) {
  const { easy, hard, failed } = tallyRatings(queue, ratings);
  const num = recordReviewSession(historyId, easy, hard, failed);
  const earned = expForReviewSession({
    cards: queue.length,
    learned: promo?.learned?.length || 0,
    mastered: promo?.mastered?.length || 0,
  });
  return { num, sessions: getTodaySessions(historyId), earned, level: levelInfo(addExp(earned)) };
}
