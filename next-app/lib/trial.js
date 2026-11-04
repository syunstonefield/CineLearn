// 初回体験（docs/design-first-run-trial-2026-11-05.md）の作品データと語の選び方。依存の少ない純関数。
//
// ⚠ 法務の条件（回答1・2）:
//   - ポスターは作品ごとに固定（posterPath・オーナー確認済み）。1人の顔のアップが主役のものを避ける。俳優名を出さない。
//   - reason は学習面の事実だけ。「人気」「いま話題」「おすすめ No.1」「公式」「配信中」「Netflix」「独占」「オリジナル」は書かない。
//     作品選択の画面に出るので、ここに配信サービスの名前を入れない（配信先は watchService に分ける）。
//   - watchService の確認は作品・予習部門の担当。月1回とカタログ更新時に確認する（TMDB/JustWatch の値・最終確認 2026-11-05）。
//     表示は作品ごとの watchService から「○○ で探す」の文字ボタンと「本サービスは ○○ と提携していません」を出す（ロゴとブランドの色なし）。
//   - Stranger Things の「第1話は4作の中で易しい語の割合が高め」は vocab_cache の第1話の実測に基づく比較（2026-11-05）。
//     リストを作り直して順位が変わったら、この文を見直す。
// 語はオーナー確定（2026-11-05）。quiz は words の中の3語。語を変える時はオーナーに確認する。
import { exampleContainsWord } from './subtitles';
import { buildQuizQuestions } from './prep';
import { episodeCredit } from './storage';

export const TRIAL_LEVELS = [
  { score: 300, level: 'A2', range: '〜 400点', label: '初級' },
  { score: 550, level: 'B1', range: '400〜 600点', label: '中級' },
  { score: 750, level: 'B2', range: '600〜 800点', label: '中上級' },
  { score: 900, level: 'C1', range: '800点〜', label: '上級' },
];

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
export const posterUrl = (title) => (title?.posterPath ? `${POSTER_BASE}${title.posterPath}` : null);

export const TRIAL_TITLES = [
  {
    id: 'suits',
    tmdbId: 37680,
    type: 'tv',
    season: 1,
    episode: 1,
    title: 'Suits',
    label: 'SUITS',
    posterPath: '/vQiryp6LioFxQThywxbC6TuoDjy.jpg',
    watchService: 'Netflix',
    reason: '法律事務所の会話。交渉や昇進など、仕事の語が出てきます',
    bands: {
      low: { words: ['promotion', 'scholarship', 'negotiate', 'workout', 'showoff'], quiz: ['promotion', 'scholarship', 'negotiate'] },
      high: { words: ['precedent', 'attached', 'cheat', 'dismiss', 'patronizing'], quiz: ['precedent', 'attached', 'cheat'] },
    },
  },
  {
    id: 'friends',
    tmdbId: 1668,
    type: 'tv',
    season: 1,
    episode: 1,
    title: 'Friends',
    label: 'Friends',
    posterPath: '/x8W8I6J8HxPwuYqkMUFuqhWdpUm.jpg',
    watchService: 'Netflix',
    reason: '友人どうしの日常の会話。1話が約23分の短い作品です',
    bands: {
      low: { words: ['flavor', 'crush', 'calm', 'cancel', 'furniture'], quiz: ['flavor', 'crush', 'calm'] },
      high: { words: ['upbeat', 'metaphor', 'fixate', 'symbolic', 'vulnerability'], quiz: ['upbeat', 'metaphor', 'fixate'] },
    },
  },
  {
    id: 'stranger',
    tmdbId: 66732,
    type: 'tv',
    season: 1,
    episode: 1,
    title: 'Stranger Things',
    label: 'Stranger Things',
    posterPath: '/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg',
    watchService: 'Netflix',
    reason: '子どもたちと町の人の会話。第1話は4作の中で易しい語の割合が高めです',
    bands: {
      low: { words: ['trust', 'appreciate', 'interrupt', 'ruin', 'flashlight'], quiz: ['trust', 'appreciate', 'interrupt'] },
      high: { words: ['sensitive', 'shift', 'nightmare', 'volunteer', 'campaign'], quiz: ['sensitive', 'shift', 'nightmare'] },
    },
  },
  {
    id: 'ironman',
    tmdbId: 1726,
    type: 'movie',
    season: 0,
    episode: 0,
    title: 'Iron Man',
    label: 'Iron Man',
    posterPath: '/fVF7ePt3lJyMjcbMOIYWMyneVVO.jpg',
    watchService: 'Netflix',
    reason: '約2時間の映画1本。会社や技術の話が多く、語の数も多めです',
    bands: {
      low: { words: ['ridiculous', 'selfish', 'intimidate', 'complicated', 'hiccup'], quiz: ['ridiculous', 'selfish', 'intimidate'] },
      high: { words: ['indifferent', 'astute', 'objectivity', 'prestigious', 'discreet'], quiz: ['indifferent', 'astute', 'objectivity'] },
    },
  },
];

// 文字リンクの2作（法務: 「プラダを着た悪魔」は全部書く・ポスターを出すなら 64px まで＝第一版は出さない）。
export const TRIAL_MORE_TITLES = [
  {
    id: 'emily',
    tmdbId: 82596,
    type: 'tv',
    season: 1,
    episode: 1,
    title: 'Emily in Paris',
    label: 'Emily in Paris',
    posterPath: null,
    watchService: 'Netflix',
    reason: '',
    bands: {
      low: { words: ['promotion', 'adventure', 'weird', 'bonus', 'manager'], quiz: ['promotion', 'adventure', 'weird'] },
      high: { words: ['asset', 'arrogant', 'pitch', 'translation', 'refinement'], quiz: ['asset', 'arrogant', 'pitch'] },
    },
  },
  {
    id: 'prada',
    tmdbId: 350,
    type: 'movie',
    season: 0,
    episode: 0,
    title: 'The Devil Wears Prada',
    label: 'プラダを着た悪魔',
    posterPath: null,
    watchService: 'Disney+',
    reason: '',
    bands: {
      low: { words: ['appointment', 'unpredictable', 'journalist', 'graduate', 'errand'], quiz: ['appointment', 'unpredictable', 'journalist'] },
      high: { words: ['crucial', 'sack', 'legend', 'incompetence', 'guard'], quiz: ['crucial', 'sack', 'legend'] },
    },
  },
];

export const bandOf = (score) => (Number(score) >= 600 ? 'high' : 'low');

// 並び順は同じ大きさのまま、先頭だけレベルで変える（〜600点=Stranger Things、600点〜=SUITS）。
export function orderTrialTitles(score) {
  const order = bandOf(score) === 'high' ? ['suits', 'ironman', 'stranger', 'friends'] : ['stranger', 'friends', 'suits', 'ironman'];
  return order.map((id) => TRIAL_TITLES.find((t) => t.id === id));
}

// /api/trial-catalog の enabled で外された作品を隠す（権利者の要請・法務 F）。enabled が配列でない＝取得失敗は全部出す。
export function filterEnabled(titles, enabled) {
  if (!Array.isArray(enabled)) return titles;
  return titles.filter((t) => enabled.includes(t.tmdbId));
}

// 体験に出してよい語か（設計: 字幕語・context 以外・例文に語がある・和訳と意味あり・例文20〜90字）。
const STRONG = /\b(fuck\w*|motherfuck\w*|shit\w*|bitch\w*|asshole\w*|ass|dick\w*|douche\w*|pussy|cock\w*|wang|whore\w*|slut\w*|queer|bastard\w*|cunt\w*|tits?|boobs?|penis|vagina|erectile|rape\w*|masturbat\w*|horny|blowjob|sex\w*|porn\w*|semen|condom\w*|goddamn|damn\w*|crap\w*|piss\w*|screw\w*|nazi\w*|nigg\w*|fag\w*|retard\w*|kill\w*|murder\w*|suicid\w*|cocaine|heroin|meth\w*|stoner|hooker\w*|prostitut\w*)\b/i;

export function isTrialEligible(w) {
  if (!w || w.source !== 'drama' || w.tier === 'context') return false;
  const word = String(w.word || '');
  const ex = String(w.example || '');
  if (!/^[a-z][a-z-]*$/.test(word)) return false; // 1語だけ（語句と固有名詞は外す）
  if (ex.length < 20 || ex.length > 90 || !w.example_ja || !w.definition) return false;
  if (!exampleContainsWord(ex, word)) return false;
  return !STRONG.test(word) && !STRONG.test(ex);
}

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const bandTarget = (band) => CEFR.indexOf(band === 'high' ? 'B2' : 'B1');

// 機械の選び方（確定の語が行に無い時の予備）。帯の段階に近い順・同じなら早い場面から。
function machinePick(pool, band, n, taken = new Set()) {
  const t = bandTarget(band);
  const rank = (w) => {
    const i = CEFR.indexOf(String(w.levelShown || w.level || '').toUpperCase());
    return i < 0 ? 9 : Math.abs(i - t);
  };
  const seen = new Set(taken); // 同じ語が行に2回ある時（プラダの survive）に重ねない
  return pool
    .filter((w) => isTrialEligible(w) && !seen.has(w.word))
    .sort((a, b) => rank(a) - rank(b) || (a.tsSec ?? Infinity) - (b.tsSec ?? Infinity))
    .filter((w) => !seen.has(w.word) && seen.add(w.word))
    .slice(0, n);
}

// 体験の5語とクイズの3語。list＝その人の絞り込み後の語。確定の語が行に無ければ機械の選び方で埋める。
//   戻り値: { words:[5語], quiz:[3語], fromFixed:確定の語を使った数 } / 3語に満たなければ null（この作品は出さない）。
export function pickTrialWords(title, list, score) {
  const band = bandOf(score);
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  const fixed = title?.bands?.[band];
  const byWord = new Map(arr.map((w) => [w.word, w]));
  const words = (fixed?.words || []).map((x) => byWord.get(x)).filter(Boolean);
  const fromFixed = words.length;
  if (words.length < 5) {
    words.push(...machinePick(arr, band, 5 - words.length, new Set(words.map((w) => w.word))));
  }
  if (words.length < 3) return null;
  const quiz = (fixed?.quiz || []).map((x) => words.find((w) => w.word === x)).filter(Boolean);
  for (const w of words) {
    if (quiz.length >= 3) break;
    if (!quiz.includes(w)) quiz.push(w);
  }
  return { words: words.slice(0, 5), quiz: quiz.slice(0, 3), fromFixed };
}

// ホームの「続きから」等で開ける作品の形（openDrama の d と同じ）。サービス選択を飛ばすため viewingService を持つ。
export function trialDrama(title) {
  return {
    title: title.title,
    englishTitle: title.title,
    tmdbId: title.tmdbId,
    type: title.type,
    mediaType: title.type,
    posterPath: posterUrl(title),
    level: '',
    platform: '',
    genre: '',
    reason: '',
    viewingService: title.watchService,
    lastSeason: 1,
    lastEpisode: 1,
  };
}

// 予習とクイズに渡す一式。選択肢は体験の5語から（一覧全体から取ると強い語が選択肢に出る）。
//   credit は単語リスト・カード・クイズの3か所の出典（法務・映画は話数を書かない）。
//   meta.trial で PrepWalkthrough / PrepQuiz が体験の動きになる（予習済み・EXP・完了画面の PrepLaunch を通らない）。
//   戻り値 null＝語が足りずこの作品は出せない。
export function buildTrialSession(title, list, score) {
  const picked = pickTrialWords(title, list, score);
  if (!picked) return null;
  const isMovie = title.type === 'movie';
  const season = isMovie ? null : title.season;
  const episode = isMovie ? null : title.episode;
  return {
    list,
    words: picked.words,
    quiz: picked.quiz,
    questions: buildQuizQuestions(picked.quiz, picked.words),
    meta: {
      trial: true,
      drama: trialDrama(title),
      title: title.title,
      season,
      episode,
      isMovie,
      service: title.watchService,
      credit: episodeCredit(title.title, season, episode, isMovie),
      core: null,
    },
  };
}
