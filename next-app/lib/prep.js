// 予習エンジン（Prep Engine）の純ロジック。
// 「今夜のリハーサル」クイズの出題選定・クローズ穴埋め生成・誠実指標の計算。
// UI を持たない小関数群に閉じる（PrepQuiz / PrepLaunch / VocabScreen から使う）。

import { getWordVariants, exampleContainsWord } from './subtitles';
import { loadSrs, isMastered } from './storage';
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

// 1問分の選択肢を作る。正解語＋同リストの別語2つ（ダミー）をシャッフルして返す。
// ダミーは pool（出題語以外の語）から語形が重複しないように選ぶ。
export function buildChoices(answerWord, pool, count = 3) {
  const answer = answerWord.word;
  const used = new Set([answer.toLowerCase()]);
  const distractors = [];
  const shuffled = pool
    .filter((w) => w.word && !used.has(w.word.toLowerCase()))
    .sort(() => Math.random() - 0.5);
  for (const w of shuffled) {
    if (distractors.length >= count - 1) break;
    if (used.has(w.word.toLowerCase())) continue;
    used.add(w.word.toLowerCase());
    distractors.push(w.word);
  }
  return [answer, ...distractors].sort(() => Math.random() - 0.5);
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
