// 関連語を選ぶ（端末の中だけ・2026-11-17）。★⑦裏側の持ち物（④は呼ぶだけ）。
//   学んだ語の一覧をサーバーへ送って選ぶ形にはしない（法務の条件）。ここは localStorage の history・SRS と、まるごと取った表（lib/catTable.js）だけを見る。
//   画面に出してよいのは 語・意味・作品名・数だけ（例文を並べた一覧は作らない）＝戻り値の項目もそれだけにしてある。

import { catOf, CAT_OTHER, CATEGORIES } from './relCategories.js';
import { tableEntry, catTableNow } from './catTable.js';

const keyOf = (w) => String(w?.word || '').trim().toLowerCase();

// 語の値。語に無い時（拡張で保存した語・まだ埋まっていない語）は表（cat-words.json）から引く（2026-11-18）。
//   戻り値 { cat, sub } または null。other はそのまま返す。
export function catOfAny(w, table = catTableNow()) {
  const c = catOf(w);
  if (c) return c;
  const e = tableEntry(w?.word, table);
  return e ? { cat: e.cat, sub: e.sub } : null;
}

// 日本語の意味の近さ（端末だけ・表に番号が無い語の並びに使う）。漢字・カタカナの1字と、2字の並びの重なり。
//   「する」「した」のような言い回しの重なりは数えない。
const STOP2 = new Set(['する', 'した', 'して', 'され', 'れる', 'られ', 'ない', 'こと', 'もの', 'いる', 'ある', 'させ', 'せる', 'な人', '的な']);
function grams(s) {
  const t = String(s || '').replace(/[\s、。・,.;:（）()「」『』［］\[\]〜~…\-–—!?！？/／]+/g, '');
  const g = new Set();
  for (let i = 0; i < t.length; i++) {
    if (!/[\u3040-\u309f]/.test(t[i])) g.add(t[i]);
    if (i + 1 < t.length) {
      const b = t.slice(i, i + 2);
      if (!STOP2.has(b)) g.add(b);
    }
  }
  return g;
}
export function defScore(a, b) {
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.sqrt(A.size * B.size);
}

// 小が同じ語を「意味が近い順」に並べる（2026-11-18 オーナー決定）。
//   1) 表の並びの番号の差が小さい順（target と語の両方に、同じ小の番号がある時）
//   2) 番号が無い語は 日本語の意味の重なりが大きい順
//   3) 同点は 最近復習した順
//   words は並べ替えたコピーを返す（target 自身は呼ぶ側で除く）。
export function nearSort(target, words, { srs = {}, table = catTableNow() } = {}) {
  const tc = catOfAny(target, table);
  const posIn = (w) => {
    const e = tableEntry(w?.word, table);
    return e && tc && e.cat === tc.cat && e.sub === tc.sub && e.pos !== null ? e.pos : null;
  };
  const tp = posIn(target);
  const tdef = target?.definition || target?.ja || '';
  const rows = (Array.isArray(words) ? words : []).map((w) => {
    const p = tp === null ? null : posIn(w);
    return {
      w,
      d: p === null ? Infinity : Math.abs(p - tp),
      s: defScore(tdef, w?.definition || w?.ja || ''),
      at: String(srs?.[keyOf(w)]?.lastReview || ''),
    };
  });
  rows.sort((a, b) => a.d - b.d || b.s - a.s || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return rows.map((r) => r.w);
}

// 拡張で保存した語（my_words）を、history の語と同じ形にして足す（history にある語はそのまま・2026-11-18）。
//   words … getAllVocabWords() などの語（_src つき）。myWords … 単語帳の語（ja・dramaTitle・season・episode）。
//   値（cat/sub）は付けない＝catOfAny が表から引く（保存・同期の形は変えない）。
export function withMyWords(words, myWords) {
  const base = Array.isArray(words) ? words : [];
  const seen = new Set(base.map(keyOf));
  const extra = [];
  for (const w of Array.isArray(myWords) ? myWords : []) {
    const k = keyOf(w);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    extra.push({
      ...w,
      example: w.example || w.sentence || '',
      definition: w.ja || w.definition || '',
      _src: w._src || { title: w.dramaTitle, season: w.season, episode: w.episode },
    });
  }
  return extra.length ? [...base, ...extra] : base;
}

// relatedWords(target, pool, { srs, max })
//   target … 今のカードの語（cat/sub/catv を持つ語。getDueReviewWords や getAllVocabWords の1件）
//   pool   … 候補の語（ふつうは getAllVocabWords() の戻り）
//   srs    … loadSrs() の戻り（{ 語の小文字: { lastReview, … } }）。記録がある語＝学んだ語
//   戻り値 … 最大 max 件の [{ word, definition, title, season, episode, type }]
//            小（sub）が同じ・学んだ語・自分以外。意味が近い順（nearSort）。target の値が無い／other なら []。
//   値の無い語（拡張で保存した語など）は表から引く（catOfAny）。
export function relatedWords(target, pool, { srs = {}, max = 3, table = catTableNow() } = {}) {
  const tc = catOfAny(target, table);
  if (!tc || tc.cat === CAT_OTHER) return [];
  const self = keyOf(target);
  const seen = new Set([self]);
  const hits = [];
  for (const w of Array.isArray(pool) ? pool : []) {
    const k = keyOf(w);
    if (!k || seen.has(k)) continue;
    const c = catOfAny(w, table);
    if (!c || c.cat !== tc.cat || c.sub !== tc.sub) continue;
    if (!srs?.[k]) continue;
    seen.add(k);
    hits.push(w);
  }
  return nearSort(target, hits, { srs, table }).slice(0, Math.max(0, max)).map((w) => ({
    word: w.word,
    definition: w.definition || w.ja || '',
    title: w._src?.title || w.dramaTitle || '',
    season: w._src?.season ?? w.season ?? null,
    episode: w._src?.episode ?? w.episode ?? null,
    type: w._src?.type || null,
  }));
}

// 大ごとのまとまり（復習タブの「大ごとの復習」用）。
//   words … 候補（getDueReviewWords() など。出す語の絞り込みは呼ぶ側）
//   戻り値 … 一覧の順の [{ cat, label, words: [語…], count }]。語の無い大・other・値の無い語は入れない。
export function groupByCat(words, { table = catTableNow() } = {}) {
  const by = new Map();
  for (const w of Array.isArray(words) ? words : []) {
    const c = catOfAny(w, table);
    if (!c || c.cat === CAT_OTHER) continue;
    if (!by.has(c.cat)) by.set(c.cat, []);
    by.get(c.cat).push(w);
  }
  return CATEGORIES.filter((c) => by.has(c.code)).map((c) => ({ cat: c.code, label: c.label, words: by.get(c.code), count: by.get(c.code).length }));
}
