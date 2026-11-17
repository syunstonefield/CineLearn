// 復習カードの裏に出す「近い意味の、学んだ語」の表示用データ（④の持ち物・2026-11-17 オーナー決定）。
//   語の分類の表と関連語の選び方は⑦の lib/relCategories.js・lib/related.js（④は呼ぶだけ・編集しない）。
//   法務の条件（2026-11-17）: 出すのは 語・意味・作品名（文字だけ）だけ。ほかの語の例文・画像は出さない。本人の端末の中だけ。
import { getAllVocabWords, loadSrs } from './storage';
import { relatedWords, groupByCat, catOfAny, nearSort, withMyWords } from './related';
import { catLabel, subLabel, CATEGORIES } from './relCategories';

export const RELATED_MAX = 3;

// 画面に渡す形 { catName, words:[{ word, definition, work }] }。関連語がなければ null（＝今のカードのまま）。
//   値の無い語・other・学んだ語に同じ小が無い語は null。値の無い語（拡張で保存した語）は⑦の表で引く（catOfAny）。
export function relatedViewFor(w, pool, srs) {
  const picked = relatedWords(w, pool, { srs, max: RELATED_MAX });
  if (!picked.length) return null;
  const c = catOfAny(w);
  return {
    cat: c ? c.cat : '',
    catName: c ? catLabel(c.cat) : '',
    words: picked.map((p) => ({ word: p.word, definition: p.definition || '', work: p.title || '' })), // 作品名は文字だけ（話数は出さない）
  };
}

// 復習を開いた時に1回だけ作る候補（学んだ語の一覧）。
//   myWords … 拡張で保存した語（getActiveWords の戻り・2026-11-18）。history に無い語を足す（SRS に記録がある語だけが札に出る）。
export function relatedPool(myWords = []) {
  return { pool: withMyWords(getAllVocabWords(), myWords), srs: loadSrs() };
}

// ── カテゴリで復習（第2便・2026-11-17）────────────────────────────────
//   学んだ語（SRS に記録がある語）を大ごとにまとめる（⑦の groupByCat＝一覧の順・0語の大と other・値なしは入れない）。
//   一覧に出すのは 名前と数だけ（例文を並べない・法務）。カードは今の復習カードで1枚ずつ（出典の行は今のまま）。
//   SRS の扱いは作品別の復習の「もう一度見る」と同じ＝期日に関係なく全部出し（openReview の all）、答えは今までどおり記録に入る。
//   activeKeys … アーカイブした作品の語を除く（storage.activeWordKeys・null＝全部。拡張で保存した語を入れる時は myWords も渡して作る）
//   myWords … 拡張で保存した語（2026-11-18・値は⑦の表で引く・SRS に記録がある語だけ）
export function learnedWords(history, srs = loadSrs(), activeKeys = null, myWords = []) {
  return withMyWords(getAllVocabWords(history), myWords).filter((w) => {
    const k = String(w.word || '').toLowerCase();
    return srs[k] && (!activeKeys || activeKeys.has(k));
  });
}

export function catReviewGroups(history, srs = loadSrs(), activeKeys = null, myWords = []) {
  return groupByCat(learnedWords(history, srs, activeKeys, myWords));
}

// その大の学んだ語をカードの形に（期日の来た語を先に・あとは最近答えた順）。_catReview＝進み具合の見出しに使う大の名前。
export function catReviewCards(cat, history, srs = loadSrs(), { toCard = (w) => w, activeKeys = null, myWords = [] } = {}) {
  const g = catReviewGroups(history, srs, activeKeys, myWords).find((x) => x.cat === cat);
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

// ── カードの大の名前（○○ ›）から開く一覧のシート（2026-11-17 オーナー「復習を始めずに、下から一覧を」）──────
//   いまの語と小が同じ学んだ語（札の3つに入らなかった語も全部）を上に、その下に同じ大のほかの語を小ごとに。
//   1行＝語・意味・作品名（文字だけ）。例文・セリフは並べない（法務の条件）。self＝いまの語（印を付ける）。
//   戻り値 { cat, label, count, near:[行], subs:[{ sub, label, words:[行] }] }。大が無い・other は null。
//   near の並びは⑦の nearSort（意味が近い順・2026-11-18）。myWords … 拡張で保存した語（値は表で引く）。
export function catSheetData(target, history, srs = loadSrs(), activeKeys = null, myWords = []) {
  const tc = catOfAny(target);
  if (!tc || !tc.cat || tc.cat === 'other') return null;
  const selfKey = String(target?.word || '').toLowerCase();
  const at = (w) => String(srs[String(w.word || '').toLowerCase()]?.lastReview || '');
  const row = (w) => ({
    word: w.word,
    definition: w.definition || w.ja || '',
    work: w._src?.title || w.dramaTitle || '',
    self: String(w.word || '').toLowerCase() === selfKey,
  });
  const cOf = (w) => catOfAny(w);
  const inCat = learnedWords(history, srs, activeKeys, myWords).filter((w) => cOf(w)?.cat === tc.cat);
  if (!inCat.some((w) => String(w.word || '').toLowerCase() === selfKey) && target?.word) inCat.unshift(target);
  const recent = (a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0);
  const near = nearSort(target, inCat.filter((w) => cOf(w)?.sub === tc.sub), { srs });
  near.sort((a, b) => (row(b).self ? 1 : 0) - (row(a).self ? 1 : 0)); // いまの語をいちばん上に
  const def = CATEGORIES.find((c) => c.code === tc.cat);
  const subs = (def?.subs || [])
    .filter((x) => x.code !== tc.sub)
    .map((x) => ({ sub: x.code, label: subLabel(tc.cat, x.code), words: inCat.filter((w) => cOf(w)?.sub === x.code).sort(recent).map(row) }))
    .filter((g) => g.words.length);
  const known = new Set([tc.sub, ...(def?.subs || []).map((x) => x.code)]);
  const rest = inCat.filter((w) => !known.has(cOf(w)?.sub)).sort(recent).map(row);
  if (rest.length) subs.push({ sub: '', label: 'そのほか', words: rest });
  return { cat: tc.cat, label: catLabel(tc.cat), count: inCat.length, near: near.map(row), subs };
}
