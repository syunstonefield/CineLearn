// #19: フラッシュカードのチャンク表示（単語単体でなく "look forward to" のような連語で見せる）。
// chunk 内の対象語（活用形ゆるめ一致）を強調表示できるよう before/hit/after に分割する。
// chunk が無い・対象語を含まない場合は null（呼び出し側は単語のみ表示にフォールバック）。
export function chunkParts(chunk, word) {
  const c = String(chunk || '').trim();
  const w = String(word || '').trim();
  if (!c || !w || c.toLowerCase() === w.toLowerCase()) return null;

  // 語頭一致（活用形: looks/looking/looked 等を拾う）。フレーズ語 w（give up 等）は先頭語で照合。
  const head = w.split(/\s+/)[0].toLowerCase();
  const tokens = c.split(/(\s+)/); // 区切りの空白も保持
  let pos = 0;
  for (const t of tokens) {
    const bare = t.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
    if (bare && (bare === head || (head.length >= 4 && bare.startsWith(head.slice(0, -1))))) {
      return {
        before: c.slice(0, pos),
        hit: t,
        after: c.slice(pos + t.length),
      };
    }
    pos += t.length;
  }
  return { before: '', hit: '', after: c }; // 対象語を特定できない → チャンク全体を通常表示
}
