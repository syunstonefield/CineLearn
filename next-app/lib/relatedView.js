// 復習カードの裏に出す「近い意味の、学んだ語」の表示用データ（④の持ち物・2026-11-17 オーナー決定）。
//   語の分類の表と関連語の選び方は⑦の lib/relCategories.js・lib/related.js（④は呼ぶだけ・編集しない）。
//   法務の条件（2026-11-17）: 出すのは 語・意味・作品名（文字だけ）だけ。ほかの語の例文・画像は出さない。本人の端末の中だけ。
import { getAllVocabWords, loadSrs } from './storage';
import { relatedWords } from './related';
import { catOf, catLabel } from './relCategories';

export const RELATED_MAX = 3;

// 画面に渡す形 { catName, words:[{ word, definition, work }] }。関連語がなければ null（＝今のカードのまま）。
//   値の無い語・other・学んだ語に同じ小が無い語は null。
export function relatedViewFor(w, pool, srs) {
  const picked = relatedWords(w, pool, { srs, max: RELATED_MAX });
  if (!picked.length) return null;
  const c = catOf(w);
  return {
    catName: c ? catLabel(c.cat) : '',
    words: picked.map((p) => ({ word: p.word, definition: p.definition || '', work: p.title || '' })), // 作品名は文字だけ（話数は出さない）
  };
}

// 復習を開いた時に1回だけ作る候補（学んだ語の一覧）。
export function relatedPool() {
  return { pool: getAllVocabWords(), srs: loadSrs() };
}
