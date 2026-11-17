// 復習カードの裏に出す「近い意味の、学んだ語」の表示用データ（④の持ち物・2026-11-17 オーナー決定）。
//   語の分類の表と関連語の選び方は⑦の lib/relCategories.js・lib/related.js（④は呼ぶだけ・編集しない）。
//   法務の条件（2026-11-17）: 出すのは 語・意味・作品名（文字だけ）だけ。ほかの語の例文・画像は出さない。本人の端末の中だけ。
import { getAllVocabWords, loadSrs } from './storage';
import { relatedWords, groupByCat } from './related';
import { catOf, catLabel } from './relCategories';

export const RELATED_MAX = 3;

// 画面に渡す形 { catName, words:[{ word, definition, work }] }。関連語がなければ null（＝今のカードのまま）。
//   値の無い語・other・学んだ語に同じ小が無い語は null。
export function relatedViewFor(w, pool, srs) {
  const picked = relatedWords(w, pool, { srs, max: RELATED_MAX });
  if (!picked.length) return null;
  const c = catOf(w);
  return {
    cat: c ? c.cat : '',
    catName: c ? catLabel(c.cat) : '',
    words: picked.map((p) => ({ word: p.word, definition: p.definition || '', work: p.title || '' })), // 作品名は文字だけ（話数は出さない）
  };
}

// 復習を開いた時に1回だけ作る候補（学んだ語の一覧）。
export function relatedPool() {
  return { pool: getAllVocabWords(), srs: loadSrs() };
}

// ── カテゴリで復習（第2便・2026-11-17）────────────────────────────────
//   学んだ語（SRS に記録がある語）を大ごとにまとめる（⑦の groupByCat＝一覧の順・0語の大と other・値なしは入れない）。
//   一覧に出すのは 名前と数だけ（例文を並べない・法務）。カードは今の復習カードで1枚ずつ（出典の行は今のまま）。
//   SRS の扱いは作品別の復習の「もう一度見る」と同じ＝期日に関係なく全部出し（openReview の all）、答えは今までどおり記録に入る。
//   activeKeys … アーカイブした作品の語を除く（storage.activeWordKeys・null＝全部）
export function learnedWords(history, srs = loadSrs(), activeKeys = null) {
  return getAllVocabWords(history).filter((w) => {
    const k = String(w.word || '').toLowerCase();
    return srs[k] && (!activeKeys || activeKeys.has(k));
  });
}

export function catReviewGroups(history, srs = loadSrs(), activeKeys = null) {
  return groupByCat(learnedWords(history, srs, activeKeys));
}

// その大の学んだ語をカードの形に（期日の来た語を先に・あとは最近答えた順）。_catReview＝進み具合の見出しに使う大の名前。
export function catReviewCards(cat, history, srs = loadSrs(), { toCard = (w) => w, activeKeys = null } = {}) {
  const g = catReviewGroups(history, srs, activeKeys).find((x) => x.cat === cat);
  if (!g) return [];
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const ent = (w) => srs[String(w.word || '').toLowerCase()] || {};
  const due = (w) => String(ent(w).dueDate || '') <= ds;
  const words = [...g.words].sort((a, b) => {
    const da = due(a), db = due(b);
    if (da !== db) return da ? -1 : 1;
    const la = String(ent(a).lastReview || ''), lb = String(ent(b).lastReview || '');
    return la < lb ? 1 : la > lb ? -1 : 0;
  });
  return words.map((w) => ({ ...toCard(w), _src: w._src, _catReview: g.label }));
}
