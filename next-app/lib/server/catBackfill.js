// 前に作った語に「意味のカテゴリ」を後から付ける（seed/backfill-cats.mjs から使う・2026-11-17）。
//   AI には 語・品詞・意味・例文だけを渡し、番号とコードだけを返させる。分類の一覧は lib/relCategories.js（自作）だけを載せる。
//   ★ログにプロンプト・応答本文を出さない（A20）。
// seed（素の Node）からも import するため相対 import だけ。

import { catPromptList, catFields, catOf } from '../relCategories.js';

export const CAT_BATCH = 60; // 1回に渡す語の数

// 値がまだ無い語だけ（版の違う語も付け直す）
export function needsCat(w) {
  return !!(w && w.word && !catOf(w));
}

const clean = (s, n) => String(s || '').replace(/[\t\n\r]+/g, ' ').trim().slice(0, n);

export function buildCatPrompt(items) {
  const lines = items.map((w, i) => `${i}\t${clean(w.word, 60)}\t${clean(w.pos, 20)}\t${clean(w.definition, 80)}\t${clean(w.example, 200)}`);
  return `英単語（または句）ごとに、その例文の場面での意味に合う「意味のカテゴリ」を下の一覧から1つだけ選んでください。
- 例文が無い語は、日本語の意味で選ぶ。
- 句は句全体の意味で選ぶ。
- 人の気持ち・人がら・人どうしの関わりを表す語は、まず 感情・性格・人がら・人との関係 の3つの大から探す。
- 小は語の意味そのもので選ぶ（場面の話題に引っぱられない）。
- 合うものが無ければ other でよい（無理に当てはめない）。一覧に無いコードは作らない。

【一覧（コード（名前））】
${catPromptList()}

【語】番号<TAB>語<TAB>品詞<TAB>日本語の意味<TAB>例文
${lines.join('\n')}

返答は1語1行で「番号<TAB>コード」だけ（説明は書かない）。例:
0\temotion.anger
1\tother`;
}

// 応答 → 番号ごとの値（{ cat, sub, catv }）。読めない行・範囲外の番号は無視（その語は付けないまま＝次の回に回る）。
export function parseCatReply(text, n) {
  const out = new Array(n).fill(null);
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+([a-z]+(?:\.[a-z]+)?)\s*$/i);
    if (!m) continue;
    const i = Number(m[1]);
    if (i >= 0 && i < n && !out[i]) out[i] = catFields(m[2]);
  }
  return out;
}
