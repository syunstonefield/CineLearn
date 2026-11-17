// 関連語を選ぶ（端末の中だけ・2026-11-17）。★⑦裏側の持ち物（④は呼ぶだけ）。
//   学んだ語の一覧をサーバーへ送って選ぶ形にはしない（法務の条件）。ここは localStorage の history・SRS だけを見る。
//   画面に出してよいのは 語・意味・作品名・数だけ（例文を並べた一覧は作らない）＝戻り値の項目もそれだけにしてある。

import { catOf, CAT_OTHER, CATEGORIES } from './relCategories.js';

const keyOf = (w) => String(w?.word || '').trim().toLowerCase();

// relatedWords(target, pool, { srs, max })
//   target … 今のカードの語（cat/sub/catv を持つ語。getDueReviewWords や getAllVocabWords の1件）
//   pool   … 候補の語（ふつうは getAllVocabWords() の戻り）
//   srs    … loadSrs() の戻り（{ 語の小文字: { lastReview, … } }）。記録がある語＝学んだ語
//   戻り値 … 最大 max 件の [{ word, definition, title, season, episode, type }]
//            小（sub）が同じ・学んだ語・自分以外。最近復習した語から。target の値が無い／other なら []。
export function relatedWords(target, pool, { srs = {}, max = 3 } = {}) {
  const tc = catOf(target);
  if (!tc || tc.cat === CAT_OTHER) return [];
  const self = keyOf(target);
  const seen = new Set([self]);
  const hits = [];
  for (const w of Array.isArray(pool) ? pool : []) {
    const k = keyOf(w);
    if (!k || seen.has(k)) continue;
    const c = catOf(w);
    if (!c || c.cat !== tc.cat || c.sub !== tc.sub) continue;
    const e = srs?.[k];
    if (!e) continue;
    seen.add(k);
    hits.push({ w, at: String(e.lastReview || '') });
  }
  hits.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return hits.slice(0, Math.max(0, max)).map(({ w }) => ({
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
export function groupByCat(words) {
  const by = new Map();
  for (const w of Array.isArray(words) ? words : []) {
    const c = catOf(w);
    if (!c || c.cat === CAT_OTHER) continue;
    if (!by.has(c.cat)) by.set(c.cat, []);
    by.get(c.cat).push(w);
  }
  return CATEGORIES.filter((c) => by.has(c.code)).map((c) => ({ cat: c.code, label: c.label, words: by.get(c.code), count: by.get(c.code).length }));
}
