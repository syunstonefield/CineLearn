// ホームの「続きから学習」の行の札（「学ぶ」「クイズ」）を出すかどうか（オーナー決定 2026-11-12）。
//   学ぶ＝その話の単語のカードを直接開く。出せる語（cardCandidates）が無い時（全部答えて次の期日がまだ）は出さない。
//   クイズ＝その話のクイズ（誰でも使える）。問題が作れる時（buildLocalQuiz が1問以上）だけ出す。
//   どちらも単語リストのある話（履歴の行に words がある）だけ。
import { cardCandidates } from './cardDeck.js';
import { buildLocalQuiz } from './prep.js';

// 行に出す話＝いちばん新しい話（最大シーズン→その中の最大エピソード・ContinueCard の表示と同じ）。
export function latestEpisode(episodes) {
  const list = Array.isArray(episodes) ? episodes : [];
  if (!list.length) return null;
  return list.reduce((a, b) =>
    (b.season || 1) > (a.season || 1) || ((b.season || 1) === (a.season || 1) && (b.episode || 1) > (a.episode || 1)) ? b : a
  );
}

export function canLearn(entry, srs = {}, today = '') {
  const words = entry?.words;
  if (!Array.isArray(words) || !words.length) return false;
  return cardCandidates(words, srs, today).length > 0;
}

export function canQuiz(entry, srs = {}) {
  const words = entry?.words;
  if (!Array.isArray(words) || !words.length) return false;
  return buildLocalQuiz(words, srs, { count: 5, choiceCount: 4 }).length > 0;
}
