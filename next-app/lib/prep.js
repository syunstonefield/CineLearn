// 予習エンジン（Prep Engine）の純ロジック。
// 「今夜のリハーサル」クイズの出題選定・クローズ穴埋め生成・誠実指標の計算。
// UI を持たない小関数群に閉じる（PrepQuiz / PrepLaunch / VocabScreen から使う）。

import { getWordVariants, exampleContainsWord } from './subtitles';
import { loadSrs, isMastered, isDue, isStruggling } from './storage';
import { queueStatePush } from './supabase';

const CEFR_ORDER = ['A2', 'B1', 'B2', 'C1', 'C2'];

// レベル高め優先のスコア（未指定/不明は最下位扱い）。
function levelRank(w) {
  const i = CEFR_ORDER.indexOf(String(w.level || '').toUpperCase());
  return i < 0 ? -1 : i;
}

// クイズに使える＝drama由来の実セリフ例文があり、その例文に対象語（活用形含む）が
// 含まれている語。新出語でも example の文脈で recognition 形式で解ける。
function isQuizEligible(w) {
  return (
    w &&
    w.source === 'drama' &&
    typeof w.example === 'string' &&
    w.example.trim().length > 0 &&
    typeof w.word === 'string' &&
    exampleContainsWord(w.example, w.word)
  );
}

// 出題語の自動選定（最大3語）。
//   第1優先: drama × example有 × example含有 をレベル高め順で。
//   フォールバック: 3未満なら「example有」のみ（含有チェックを緩める）で補い、
//                   それでも足りなければ最終的に 0〜2 問で返す（無理に作問しない）。
// 返り値は元配列の語オブジェクト（参照）をそのまま。重複語は除外。
export function selectQuizWords(words, max = 3, srs = null) {
  // srs を渡すとマスター済み語を候補から除外（他作品で習得済みの語に予習枠を使わない・#7b）。
  const notMastered = (w) => !srs || !isMastered(srs[(w.word || '').toLowerCase()]);
  const list = (Array.isArray(words) ? words : []).filter(notMastered);
  const seen = new Set();
  const take = (cands) => {
    for (const w of cands) {
      const k = (w.word || '').toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      picked.push(w);
      if (picked.length >= max) break;
    }
  };
  const picked = [];

  const primary = list
    .filter(isQuizEligible)
    .slice()
    .sort((a, b) => levelRank(b) - levelRank(a));
  take(primary);

  if (picked.length < max) {
    // 緩めフォールバック: example はあるが含有チェックに落ちた drama 語。
    const loose = list
      .filter(
        (w) =>
          w &&
          w.source === 'drama' &&
          typeof w.example === 'string' &&
          w.example.trim().length > 0
      )
      .sort((a, b) => levelRank(b) - levelRank(a));
    take(loose);
  }

  return picked;
}

// クローズ穴埋め用に、example 中の対象語（最初の活用形マッチ）を blank へ置換する。
// 返り値: { before, blank, after } ─ before + ____ + after で1文を再構成できる。
// マッチしなければ blank=null（呼び出し側で別表示にフォールバック）。
export function buildCloze(example, word) {
  if (!example || !word) return { before: example || '', blank: null, after: '' };
  // 長い活用形（例: running）が短い形（run）に食われないよう長い順で試す。
  const variants = [...getWordVariants(word)].sort((a, b) => b.length - a.length);
  for (const v of variants) {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${esc}\\b`, 'i');
    const m = example.match(re);
    if (m && m.index != null) {
      return {
        before: example.slice(0, m.index),
        blank: m[0], // 表示している実際の活用形（正解開示に使う）
        after: example.slice(m.index + m[0].length),
      };
    }
  }
  return { before: example, blank: null, after: '' };
}

// 1問分の選択肢を作る。正解語＋同リストの別語（ダミー）をシャッフルして返す。
// ダミーの選び方（素の乱択だと学習効果が落ちるため優先順を付ける）:
//   ① 例文に既に出ている語は使わない（空欄以外の場所に答えが見えている状態を避ける）
//   ② 同品詞を優先（品詞がバラけると意味を考えず消去法で解けてしまう＝練習にならない）
//   ③ 次に同レベル帯（明らかに易しい語が並ぶと正解が浮く）
//   ④ 足りなければ残りからランダム
// 注: 「ダミーも文脈に当てはまる」複数正解事故はローカルでは判定できない（AI生成でも同様）。
//     正解は実際のセリフの語なので実害は小さいと割り切る。
export function buildChoices(answerWord, pool, count = 3) {
  const answer = answerWord.word;
  const used = new Set([answer.toLowerCase()]);
  const example = String(answerWord.example || '');
  const cands = (Array.isArray(pool) ? pool : [])
    .filter((w) => w?.word && !used.has(w.word.toLowerCase()))
    .filter((w) => !(example && exampleContainsWord(example, w.word)))
    .sort(() => Math.random() - 0.5);

  const samePos = (w) => answerWord.pos && w.pos && w.pos === answerWord.pos;
  const sameLevel = (w) => answerWord.level && w.level && w.level === answerWord.level;
  const tiers = [
    cands.filter(samePos),
    cands.filter((w) => !samePos(w) && sameLevel(w)),
    cands,
  ];

  const distractors = [];
  for (const tier of tiers) {
    for (const w of tier) {
      if (distractors.length >= count - 1) break;
      const k = w.word.toLowerCase();
      if (used.has(k)) continue;
      used.add(k);
      distractors.push(w.word);
    }
    if (distractors.length >= count - 1) break;
  }
  return [answer, ...distractors].sort(() => Math.random() - 0.5);
}

// ── 視聴後クイズ（ローカル作問）──────────────────────────────
// 以前は Claude に5問を生成させていた（1回≈¥1・レート制限あり・生成待ちあり）。
// 出題に必要な材料（語・実セリフ例文・品詞・レベル）は単語リストに全部あるので、
// クローズ（穴埋め）はローカルで組める＝APIコスト¥0・即時表示・毎回違う出題。
// 2026-08-07 オーナー提案。

// 出題語の選定。予習クイズ(selectQuizWords)がレベル高め優先なのに対し、
// こちらは「思い出せるか微妙な語」を狙う＝テスト効果（retrieval practice）が最大になる帯。
//   ⭐苦手（一度失敗＝isStruggling） > 期日到来 > 新出 の順に枠を配り、各枠内はランダム。
//   マスター済み・スキップは出題しない(#7b)。
//   枠が埋まらない分は上位カテゴリから繰り上げる（無理に問題数を落とさない）。
const POST_WATCH_QUOTA = { struggling: 2, due: 2, fresh: 1 };

// 候補を優先度順に max 語まで取り出す。seen は呼び出し側と共有して重複出題を防ぐ。
// quota を渡すとカテゴリ上限つき（＝混ざった構成になる）。省略時は優先度順にそのまま。
function pickByPriority(cands, srs, max, seen, quota) {
  const buckets = { struggling: [], due: [], fresh: [], rest: [] };
  for (const w of cands) {
    const e = srs[(w.word || '').toLowerCase()];
    if (isStruggling(e)) buckets.struggling.push(w);
    else if (!e) buckets.fresh.push(w);
    else if (isDue(e)) buckets.due.push(w);
    else buckets.rest.push(w);
  }
  Object.values(buckets).forEach((b) => b.sort(() => Math.random() - 0.5));

  const picked = [];
  const take = (bucket, n) => {
    for (const w of bucket) {
      if (picked.length >= max || n <= 0) break;
      const k = (w.word || '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push(w);
      n--;
    }
  };
  if (quota) {
    take(buckets.struggling, quota.struggling);
    take(buckets.due, quota.due);
    take(buckets.fresh, quota.fresh);
  }
  // 枠が余ったら「苦手→期日到来→未分類→新出」の順で繰り上げて埋める
  [buckets.struggling, buckets.due, buckets.rest, buckets.fresh].forEach((b) => take(b, max));
  return picked;
}

export function selectPostWatchQuizWords(words, srs = {}, max = 5, seen = new Set()) {
  const list = (Array.isArray(words) ? words : []).filter(isQuizEligible);
  return pickByPriority(list, srs, max, seen, POST_WATCH_QUOTA);
}

// 例文中の対象語を「すべて」空欄化する（同じ語が2回出るときに答えが見えるのを防ぐ）。
// 戻り値: { question, form }（form=本文での実際の活用形）。マッチしなければ null。
function blankAllOccurrences(example, word) {
  const variants = [...getWordVariants(word)].sort((a, b) => b.length - a.length);
  let out = String(example || '');
  let form = null;
  for (const v of variants) {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\b${esc}\\b`, 'i').test(out)) continue;
    if (!form) form = out.match(new RegExp(`\\b${esc}\\b`, 'i'))[0];
    out = out.replace(new RegExp(`\\b${esc}\\b`, 'gi'), '____');
  }
  return form ? { question: out, form } : null;
}

// 日本語の語義だけを返す（英語辞書定義は選択肢に混ぜない＝和英が並ぶと問題にならない）。
const JA_RE = /[぀-ヿ㐀-鿿]/;
function jaMeaning(w) {
  const m = String(w?.ja || w?.definition || '').trim();
  return JA_RE.test(m) ? m : '';
}

// 穴埋め1問（実セリフ例文つきの語）。
function buildClozeQuestion(w, pool, choiceCount) {
  const cloze = blankAllOccurrences(w.example, w.word);
  if (!cloze) return null;
  const formNote =
    cloze.form.toLowerCase() !== String(w.word).toLowerCase() ? `（本文では ${cloze.form}）` : '';
  return {
    word: w.word, // 出題順の並べ替え用（QuizScreen は question/answer/choices/explanation だけ見る）
    question: cloze.question,
    answer: w.word,
    choices: buildChoices(w, pool, choiceCount),
    explanation:
      `${w.word}${formNote}${w.pos ? `（${w.pos}）` : ''}：${w.ja || w.definition || ''}` +
      (w.example_ja ? `\n${w.example_ja}` : ''),
  };
}

// 意味当て1問（例文が無い／例文に語が含まれない語の救済）。
// 選択肢は同じ作品の他の語の語義。同品詞を優先（品詞バラバラだと消去法で解ける）。
function buildMeaningQuestion(w, pool, choiceCount) {
  const answer = jaMeaning(w);
  if (!answer) return null;
  const key = String(w.word).toLowerCase();
  const used = new Set([answer]);
  const cands = pool
    .filter((x) => x?.word && x.word.toLowerCase() !== key && jaMeaning(x) && jaMeaning(x) !== answer)
    .sort(() => Math.random() - 0.5);
  const samePos = (x) => w.pos && x.pos && x.pos === w.pos;
  const distractors = [];
  for (const tier of [cands.filter(samePos), cands]) {
    for (const x of tier) {
      if (distractors.length >= choiceCount - 1) break;
      const m = jaMeaning(x);
      if (used.has(m)) continue;
      used.add(m);
      distractors.push(m);
    }
    if (distractors.length >= choiceCount - 1) break;
  }
  if (!distractors.length) return null; // 選択肢が1つ＝問題にならない
  return {
    word: w.word,
    question: `「${w.word}」の意味は？`,
    answer,
    choices: [answer, ...distractors].sort(() => Math.random() - 0.5),
    explanation:
      `${w.word}${w.pos ? `（${w.pos}）` : ''}：${answer}` +
      (w.example ? `\n"${w.example}"` : ''),
  };
}

// 視聴後クイズを丸ごと組む。戻り値は QuizScreen が読む形
// （{ question, answer, choices, explanation }）。作問できなければ空配列。
//   ① 穴埋め（実セリフ例文つき）を優先で埋める＝場面と結びついた想起になる
//   ② 足りない分は「語→意味の4択」で埋める（例文が無い語の救済。出題形式が変わるので
//      同じエピソードを何度も受けたときの飽き対策にもなる）
export function buildLocalQuiz(words, srs = {}, { count = 5, choiceCount = 4 } = {}) {
  const pool = Array.isArray(words) ? words : [];
  const usable = pool.filter((w) => {
    if (!w?.word) return false;
    const e = srs[w.word.toLowerCase()];
    return !isMastered(e) && !e?.skipped; // 習得済み・スキップは出題しない(#7b)
  });
  const seen = new Set();

  const questions = selectPostWatchQuizWords(usable, srs, count, seen)
    .map((w) => buildClozeQuestion(w, pool, choiceCount))
    .filter(Boolean);

  if (questions.length < count) {
    const rest = pickByPriority(
      usable.filter((w) => !seen.has(w.word.toLowerCase()) && jaMeaning(w)),
      srs,
      count - questions.length,
      seen
    );
    questions.push(...rest.map((w) => buildMeaningQuestion(w, pool, choiceCount)).filter(Boolean));
  }

  // 1問目だけは易しめ（一度は正解できている＝苦手でない既習語）を置く。
  // 初手で間違えると離脱しやすいため（意欲対策）。該当が無ければ並びは変えない。
  const easyIdx = questions.findIndex((q) => {
    const e = srs[String(q.word).toLowerCase()];
    return e && !isStruggling(e);
  });
  if (easyIdx > 0) questions.unshift(questions.splice(easyIdx, 1)[0]);
  return questions;
}

// 出題3語から3問を組み立てる。pool は単語リスト全体（ダミー語の母集団）。
export function buildQuizQuestions(quizWords, pool) {
  return quizWords.map((w) => ({
    word: w,
    cloze: buildCloze(w.example, w.word),
    example: w.example,
    example_ja: w.example_ja || '',
    choices: buildChoices(w, pool),
    answer: w.word,
  }));
}

// ── 誠実指標（予習時点で真な数だけ）─────────────────────────
// 「覚えた」は使わない（予習直後は SRS 上ほぼ全語 new のため嘘になる）。
//   prepared : このリストの語数
//   withExample : 実セリフ例文（drama由来 example）が付いた語数
//   fresh : SRS にエントリが無い＝今夜が初対面の語数（＝新出）
export function prepIntegrity(words) {
  const list = Array.isArray(words) ? words : [];
  const srs = loadSrs();
  let withExample = 0;
  let fresh = 0;
  for (const w of list) {
    if (w.source === 'drama' && typeof w.example === 'string' && w.example.trim()) withExample++;
    if (!srs[(w.word || '').toLowerCase()]) fresh++;
  }
  return { prepared: list.length, withExample, fresh };
}

// 予習ウォークスルーのデッキ並び替え。
//   新出（SRS未登録＝今夜が初対面）を先頭に、その中はレベル高め優先。
//   元の並び（タイムスタンプ順）は安定保持（同条件はindex順）。
//   狙い：途中で離脱しても“見ておくべき重要語”が先に出る＝67枚全部見なくても効く。
export function orderWordsForPrep(words, srs) {
  const list = Array.isArray(words) ? words : [];
  const s = srs || {};
  return list
    .map((w, i) => ({
      w,
      i,
      fresh: s[(w.word || '').toLowerCase()] ? 0 : 1,
      lvl: levelRank(w),
    }))
    .sort((a, b) => b.fresh - a.fresh || b.lvl - a.lvl || a.i - b.i)
    .map((x) => x.w);
}

// ── 予習完了の永続化（リロードでの半券再取得＝席番号インフレを防ぐ）──────
//   プロフィール非依存。エピソード単位で1回だけ記録。
//   getPrepped が返す seat を再予習でも使い回す＝nextSeat() を初回のみ呼ぶための土台。
//   2026-07-02 から user_state 経由でクラウド同期（マージは union・at 古い方＝初回予習を正）。
const PREPPED_KEY = 'cl_prepped';
function loadPrepped() {
  try {
    return JSON.parse(localStorage.getItem(PREPPED_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
export function getPrepped(epId) {
  if (!epId) return null;
  return loadPrepped()[epId] || null; // { at, seat } | null
}
export function markPrepped(epId, seat) {
  if (!epId) return null;
  const all = loadPrepped();
  if (!all[epId]) {
    all[epId] = { at: Date.now(), seat: seat || '' };
    try {
      localStorage.setItem(PREPPED_KEY, JSON.stringify(all));
      queueStatePush(PREPPED_KEY, 500); // クラウドへ（未ログイン時は no-op）
    } catch {
      /* プライベートモード等は保存をあきらめる */
    }
  }
  return all[epId];
}

// 視聴サービスの作品ディープリンク（作品単位・場面tsSecは使わない）。
// 各サービスの動画IDは保持しないため検索URLに留める（非提携・正規アプリへ）。
// service は selectedViewingService（ServiceSelect の svc.name）＝
//   'Netflix' / 'Amazon Prime' / 'Disney+' / 'Apple TV+' / 'Hulu'。
//   未選択(null)は Netflix にフォールバック。⚠地域差(amazon.co.jp/hulu.jp 等)は要確認。
export function watchSearchUrl(title, service) {
  const q = encodeURIComponent(title || '');
  const s = (service || '').toLowerCase();
  if (s.includes('prime') || s.includes('amazon')) {
    return `https://www.amazon.com/s?k=${q}&i=instant-video`;
  }
  if (s.includes('disney')) return `https://www.disneyplus.com/search?q=${q}`;
  if (s.includes('apple')) return `https://tv.apple.com/search?term=${q}`;
  if (s.includes('hulu')) return `https://www.hulu.com/search?q=${q}`;
  // 既定（Netflix／未選択）。
  return `https://www.netflix.com/search?q=${q}`;
}

// プレミアパスの「指定席」を1ずつ採番して端末に記憶する（=観覧履歴の通し番号）。
//   A-01 → A-99 → B-01 → … → Z-99 → A-01（Z以降は巡回）。
//   ★パス生成時に一度だけ呼ぶ（再描画・フリップで増えないように呼び出し側で1回）。
//   2026-07-02 から user_state 経由でクラウド同期（マージは max＝採番の巻き戻り防止）。
const SEAT_KEY = 'cl_seat_counter';
export function nextSeat() {
  let n = 0;
  try {
    n = parseInt(localStorage.getItem(SEAT_KEY) || '0', 10) || 0;
  } catch {
    /* SSR/プライベートモード等は採番せず A-01 */
    return 'A-01';
  }
  n += 1;
  try {
    localStorage.setItem(SEAT_KEY, String(n));
    queueStatePush(SEAT_KEY, 500); // クラウドへ（未ログイン時は no-op）
  } catch {
    /* 保存失敗は番号だけ進めて表示（永続はしない） */
  }
  const within = ((n - 1) % 99) + 1; // 1..99
  const letter = String.fromCharCode(65 + (Math.floor((n - 1) / 99) % 26)); // A..Z 巡回
  return `${letter}-${String(within).padStart(2, '0')}`;
}
