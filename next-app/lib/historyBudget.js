// 単語リストの履歴（cl_history）を端末に残す量の決まり（2026-11-12 オーナー決定・依存なしの純関数＝node のテストから読む）。
//   以前は新しい順に50行で切っていた＝新しいリストを作るたびに一番古いリストが端末から消え、
//   作品を開くと「リストを生成」になっていた（Marvel 4作・クラウドには残っていた）。
//   上限は行数ではなく大きさ（JSON の文字数）で HISTORY_BUDGET_CHARS。1行は実測で約12KB＝約170行分。
//   超えた時に外す順:
//     1) 採点した語（SRS に記録があり「知ってる」で飛ばしていない語）が1つも無い行を、古い順に
//     2) それでも超える時だけ、採点した語のある行を古い順に
//   keepIds の行（今保存した行など）は外さない。外した行はクラウドに残る（開いた時に戻す・lib/supabase.js）。

export const HISTORY_BUDGET_CHARS = 2_000_000;

const keyOf = (w) => String(w?.word || '').toLowerCase();

export function rowHasGradedWord(row, srs) {
  return (row?.words || []).some((w) => {
    const e = srs?.[keyOf(w)];
    return !!e && !e.skipped;
  });
}

// 行の古さ（小さいほど古い）: 日付 → 同じ日付なら配列の後ろほど古い（新しい順に並んでいる）。
function ageKey(row, index) {
  return [String(row?.date || ''), -index];
}
function olderFirst(a, b) {
  if (a.age[0] !== b.age[0]) return a.age[0] < b.age[0] ? -1 : 1;
  return a.age[1] - b.age[1];
}

// history（新しい順）を budget 文字以内に収めた新しい配列を返す（並びは変えない）。
//   戻り値: { history, dropped: [行の id…] }
export function trimHistoryToBudget(history, srs = {}, { budget = HISTORY_BUDGET_CHARS, keepIds = [] } = {}) {
  const rows = Array.isArray(history) ? history : [];
  const sizes = rows.map((h) => JSON.stringify(h).length + 1);
  let total = sizes.reduce((a, b) => a + b, 2);
  if (total <= budget) return { history: rows, dropped: [] };
  const keep = new Set(keepIds.filter(Boolean));
  const cands = rows
    .map((h, i) => ({ i, id: h?.id, graded: rowHasGradedWord(h, srs), age: ageKey(h, i) }))
    .filter((c) => !keep.has(c.id));
  const order = [...cands.filter((c) => !c.graded).sort(olderFirst), ...cands.filter((c) => c.graded).sort(olderFirst)];
  const drop = new Set();
  for (const c of order) {
    if (total <= budget) break;
    drop.add(c.i);
    total -= sizes[c.i];
  }
  return { history: rows.filter((_, i) => !drop.has(i)), dropped: rows.filter((_, i) => drop.has(i)).map((h) => h?.id) };
}
