// ホームの今日の復習の札の「学習した日」（累計・オーナー決定 2026-11-13＝連続日数の表示をやめる）。
//   数え方はあゆみ・ホームの学習した日（buildGrass の studied）と同じ＝EXP の台帳で学習のあった日の数（端末をまたいで合計）。
//   台帳はクラウドに同期され、端末を替えても減らない。急がせる言い方・未達の数は出さない。
import { expByDay } from './journey.js';

// { days: 学習した日の数（今日まで）, today: 今日学習したか }
export function studiedSummary(ledger, todayKey) {
  const byDay = expByDay(ledger);
  const keys = Object.keys(byDay).filter((k) => k <= todayKey && byDay[k] > 0);
  return { days: keys.length, today: (byDay[todayKey] || 0) > 0 };
}

// 札に出す文。0日は null（呼び出し側が今の文「予習した語を、復習で覚えていきましょう」を出す）。
//   学習した日が1日で、その日が今日の時だけ「今日が1日目」（始まりを祝う・案B）。
export function studiedLine({ days, today } = {}) {
  if (!(days > 0)) return null;
  if (days === 1 && today) return '今日が1日目';
  return `学習した日 ${days}日`;
}
