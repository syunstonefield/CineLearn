// 半券（観た証）の永続化。予習クイズ完了で1枚発行し、ホームの「あの場面を思い出す」入口に使う。
// 設計の背景（2026-06-25 部署討論）: 「未視聴チケット」は視聴完了を検知できない以上ホームで
//   消えず罪悪感UI化する → 反転して「観た後に戻る半券＝シーン記憶カードへの入口」にする。
//   全チケットを発行時点で半券扱いにすれば open/archived の状態管理も視聴検知も不要。
// プロフィール別。2026-07-02 から user_state 経由でクラウド同期（機種変で消えない・マージは同一話 union）。

import { queueStatePush } from './supabase';

const MAX_TICKETS = 30; // 追記ログだが上限でFIFO（古いものから落とす）。ホームは最新1枚＋件数。

export function ticketsKey(profileId) {
  return profileId ? `cl_tickets_${profileId}` : 'cl_tickets';
}

export function loadTickets(profileId) {
  try {
    const raw = localStorage.getItem(ticketsKey(profileId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveAll(profileId, arr) {
  try {
    localStorage.setItem(ticketsKey(profileId), JSON.stringify(arr));
    queueStatePush(ticketsKey(profileId), 500); // クラウドへ（未ログイン時は no-op）
  } catch {
    /* プライベートモード等は保存をあきらめる（機能はメモリ上で動く） */
  }
}

// 同一作品・同一話を1枚に畳むためのキー。
const epKey = (t) => `${t.title}|${t.season}|${t.episode}`;

// 予習クイズ完了の launch payload から半券を1枚発行（同一話は最新で上書き＝混雑回避）。
// payload は PrepQuiz が openPrepLaunch に渡す { variant:'quiz', quizWords, seat, drama, title, season, episode, isMovie, service } 形。
export function issueTicket(profileId, payload) {
  if (!payload) return null;
  // シーン記憶カード用に、出題語を ReviewModal が読める形へ整える（出所明示も焼き込む）。
  const words = (payload.quizWords || [])
    .filter((w) => w && w.word)
    .map((w) => ({
      word: w.word,
      definition: w.definition || '',
      example: w.example || '',
      example_ja: w.example_ja || '',
      pos: w.pos || '',
      source: w.source || '',
      // subtitleCredit(w) は w._src.{title,season,episode,type} を使う。発行時メタを語に焼く。
      _src: {
        title: payload.drama?.title || payload.title || '',
        season: payload.season,
        episode: payload.episode,
        type: payload.isMovie ? 'movie' : payload.drama?.type || 'tv',
      },
    }));

  const ticket = {
    id: `${payload.drama?.tmdbId ?? payload.title ?? 'x'}-${payload.season ?? ''}-${payload.episode ?? ''}-${Date.now()}`,
    tmdbId: payload.drama?.tmdbId ?? null,
    title: payload.title || payload.drama?.title || '',
    enTitle: payload.drama?.englishTitle || payload.title || payload.drama?.title || '',
    season: payload.season ?? null,
    episode: payload.episode ?? null,
    isMovie: !!payload.isMovie,
    seat: payload.seat || '',
    service: payload.service || '',
    createdAt: Date.now(),
    words,
  };

  // 同一話は畳む（古い同話を除いてから push＝最新で置換）。「観た記録」は最新1枚で十分。
  const arr = loadTickets(profileId).filter((t) => epKey(t) !== epKey(ticket));
  arr.push(ticket);
  while (arr.length > MAX_TICKETS) arr.shift();
  saveAll(profileId, arr);
  return ticket;
}
