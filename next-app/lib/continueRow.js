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

// 行に出す話（2026-11-18 オーナーの不具合の報告「続きから学ぶで話を変えてもホームに反映されない」）。
//   この作品で最後に開いた話（myDramas の lastSeason/lastEpisode・行を押した時に openDrama が開く話）を出す。
//   その話にまだ単語リストが無くても、その話を出す（listed=false＝学ぶ・クイズの札は出さない）。
//   最後に開いた話の記憶が無い時だけ、今までどおりいちばん新しい話。
//   episodes … 単語リストのある話の一覧（[{ season, episode }]）／last … { lastSeason, lastEpisode }（myDramas の記録）
export function rowEpisode(episodes, last) {
  const s = Number(last?.lastSeason) || 0;
  const e = Number(last?.lastEpisode) || 0;
  if (s > 0 && e > 0) {
    const listed = (Array.isArray(episodes) ? episodes : []).some((x) => (x.season || 1) === s && (x.episode || 1) === e);
    return { season: s, episode: e, listed };
  }
  const l = latestEpisode(episodes);
  return l ? { season: l.season || 1, episode: l.episode || 1, listed: true } : null;
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
