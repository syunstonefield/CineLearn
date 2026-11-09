// 単語帳の旗をまとめて倒す時の「送る語」と「PostgREST の in フィルタ」（2026-11-10・⑤の不具合連絡）。
//
// my_words の一意キーは (user_id, word) で大文字小文字を区別する。以前は語を小文字にして upsert（POST＋merge-duplicates）
// していたため、大文字を含む語（固有名詞・文頭の語）では小文字の空の行が新しくでき、取り込み後に「今保存された語」に見えていた。
// → 送る語は端末にある語そのまま（大文字小文字を変えない）＋送り方は PATCH（既にある行だけ書き換え・行を作らない）。

// 端末の語の配列（複数キー分）から、指定された語（大文字小文字は無視して照合）に当たる語を、元の綴りのまま重複なく返す。
// 指定された語そのもの（呼び出し側が持っている元の綴り）も含める。
export function exactWordsToFlag(localLists, wordTexts) {
  const wanted = new Set();
  const out = new Set();
  for (const t of wordTexts || []) {
    const s = String(t || '');
    if (!s) continue;
    wanted.add(s.toLowerCase());
    out.add(s);
  }
  for (const list of localLists || []) {
    for (const w of list || []) {
      const s = String(w?.word || '');
      if (s && wanted.has(s.toLowerCase())) out.add(s);
    }
  }
  return [...out];
}

// PostgREST の in.(...) フィルタ。値はすべて二重引用符で囲み、\ と " をエスケープ（, . : ( ) を含む語でも壊れない）。
export function pgrstInFilter(values) {
  const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `in.(${(values || []).map(q).join(',')})`;
}
