// 小（意味のカテゴリの2段目）の中で、意味の近い語が隣り合うように AI に1列に並べさせる（関連語の並び順・2026-11-18）。
//   seed/build-cat-table.mjs --order から使う。結果は cat-words.json の値 'emotion.anger.12' の 12（並びの番号）。
//   ★AI に渡す材料は 指示と、その小に入っている語（と CineLearn が作った日本語の意味）だけ。外の辞書・語の一覧は使わない。
//   ★ログにプロンプト・応答本文を出さない。seed（素の Node）からも import するため相対 import だけ。

import { subLabel } from '../relCategories.js';

export const ORDER_MIN_COVER = 0.8; // 並んだ語がこれより少ない小は番号を付けない（並べ損ね）

const clean = (s, n) => String(s || '').replace(/[\t\n\r]+/g, ' ').trim().slice(0, n);

// items … [{ word, definition }]
export function buildOrderPrompt(cat, sub, items) {
  const lines = items.map((w, i) => `${i}\t${clean(w.word, 60)}\t${clean(w.definition, 60)}`);
  return `次の英単語（または句）はすべて「${subLabel(cat, sub)}」のまとまりに入っています。意味が近い語どうしが隣り合うように、全部の語を1列に並べてください（似た意味の語が続き、意味が変わるところで次の話題に移る）。
【語】番号<TAB>語<TAB>日本語の意味
${lines.join('\n')}

返答は並べた順の番号だけをカンマ区切りで1行（説明は書かない）。`;
}

// 応答 → 語ごとの並びの番号（0〜）。2回目に出た番号・範囲外は無視。並んだ語が少なすぎれば null。
//   並びに出てこなかった語は null（番号なし＝端末では意味の文字の重なりで並ぶ）。
export function parseOrderReply(text, n) {
  const pos = new Array(n).fill(null);
  let next = 0;
  for (const m of String(text || '').match(/\d+/g) || []) {
    const i = Number(m);
    if (i < 0 || i >= n || pos[i] !== null) continue;
    pos[i] = next++;
  }
  if (!n || next / n < ORDER_MIN_COVER) return null;
  return pos;
}
