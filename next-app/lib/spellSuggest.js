// 綴りミスの候補（2026-10-30 オーナー決定＝案B・法務「条件付きOK」）。
//   「単語を追加」で入力した語が字幕に見つからない時、その話の語から綴りの近い語を最大3つ選ぶ。
//   純関数＝画面（単語リストの語との比較）とサーバ（/api/example mode:'manual' の no_match）の両方で使う。
//   設計と実測: docs/research-2026-10-add-word-spell-suggest.md（6作品・足したい語の1か所ミスは上位3件に 97〜99%）。
//
// ⚠ 法務の条件（2026-10-30）: 入力4字以上／距離は入力5字以下=1・6字以上=2／3字以下の語は候補にしない／
//   候補は最大3語。COMMON_WORDS の除外はサーバ側で exclude に渡す（lib/server/commonWords.js はサーバ専用の入力ゲート）。
//   例文の付け方・上限の数え方は app/api/example/route.js 側の条件。
import { normApostrophes, wordStems, splitSrtCues } from './subtitles';

export const SPELL_MIN_INPUT = 4;
export const SPELL_MAX_CANDIDATES = 3;
export const spellAllowance = (len) => (len <= 5 ? 1 : 2);

const norm = (s) => normApostrophes(String(s ?? '')).toLowerCase().trim();
const SINGLE_WORD = /^[a-z][a-z']*$/;

// OSA 編集距離（隣の字の入れ替えを1と数える）。max を超えたら max+1 で打ち切る。
export function osaDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

// 字幕（生 SRT）の語 → [{ word, n }]。分け方は配信の照合と同じ splitSrtCues（♪歌詞・クレジット行は除く）。
//   固有名詞（出現の8割以上が大文字始まり）は除く＝人名・社名を語として勧めない。
export function wordsFromSubtitle(rawSrt) {
  const stats = new Map();
  for (const c of splitSrtCues(rawSrt)) {
    for (const tok of normApostrophes(c.text).match(/[A-Za-z][A-Za-z']*[A-Za-z]/g) || []) {
      const low = tok.toLowerCase();
      const e = stats.get(low) || { n: 0, cap: 0 };
      e.n++;
      if (/^[A-Z]/.test(tok)) e.cap++;
      stats.set(low, e);
    }
  }
  const out = [];
  for (const [word, e] of stats) if (e.cap / e.n < 0.8) out.push({ word, n: e.n });
  return out;
}

const family = (w) => new Set([w, ...wordStems(w)]);

// input に綴りの近い語を最大 max 個。words: [{ word, n? }]（n＝その話での出現回数・並べ順の最後の決め手）。
//   exclude(word) が true の語は候補にしない（サーバは COMMON_WORDS を渡す）。
//   並べ順: 距離 → 先頭の字が同じ（綴りミスで頭文字が変わることは少ない）→ 出現回数。
//   同じ語の活用形（trader/traders）は1つにまとめる（先に並んだ方を残す）。
export function suggestSpellings(input, words, { exclude = null, max = SPELL_MAX_CANDIDATES } = {}) {
  const w = norm(input);
  if (w.length < SPELL_MIN_INPUT || !SINGLE_WORD.test(w)) return [];
  const lim = spellAllowance(w.length);
  const cands = [];
  const seen = new Set();
  for (const e of words || []) {
    const t = norm(e?.word);
    if (!t || t === w || t.length <= 3 || !SINGLE_WORD.test(t) || seen.has(t)) continue;
    seen.add(t);
    if (exclude && exclude(t)) continue;
    const d = osaDistance(w, t, lim);
    if (d > lim) continue;
    cands.push({ word: t, d, first: t[0] === w[0] ? 0 : 1, n: Number(e.n) || 1 });
  }
  cands.sort((x, y) => x.d - y.d || x.first - y.first || y.n - x.n || (x.word < y.word ? -1 : 1));
  const out = [];
  const fams = [];
  for (const c of cands) {
    const f = family(c.word);
    if (fams.some((g) => [...f].some((x) => g.has(x)))) continue;
    fams.push(f);
    out.push(c.word);
    if (out.length >= max) break;
  }
  return out;
}
