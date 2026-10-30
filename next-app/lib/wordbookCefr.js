// 単語帳の語に出す CEFR の目安の「値の出どころ」（2026-10-30・試作・表を持たない純関数＝クライアントで使う）。
//   単語帳の保存レコード（my_words / cl_my_words_*）は level も levelShown も持たない（★・拡張・手入力のどの経路も
//   保存しない・DB に列も無い）。一方、予習の記録（cl_history）の words は単語リスト生成の応答そのまま＝
//   AI の level と、本番公開後に新しく開いたリストなら表の段階 levelShown も持っている。
//   そこで単語帳では、端末にある cl_history から同じ語を探して level / levelShown を借りる。
//   ⚠ サーバへは何も問い合わせない（任意の語の照会 API は法務 条件1で禁止）。借りるのは「この端末に単語リストの
//     一部として既に届いた値」だけ＝表の値を出す範囲は単語リストと同じ語に限られる。
//   品詞: 表の段階は品詞ごとなので、保存レコードと履歴の両方に品詞があって食い違う語には levelShown を借りない。

const norm = (s) => String(s ?? '').toLowerCase().trim();

// cl_history（loadHistory()）→ Map(語の小文字 → { level, levelShown, pos, dramaTitle })
//   同じ語が複数の記録にある時は、表の段階 levelShown を持つ記録を優先する（無ければ最初に見つけた AI の level）。
export function cefrIndexFromHistory(history) {
  const map = new Map();
  for (const h of history || []) {
    for (const w of h?.words || []) {
      const k = norm(w?.word);
      if (!k || /\s/.test(k)) continue; // 句動詞・イディオムは出さない（lib/cefrHint.js と同じ）
      const prev = map.get(k);
      if (prev && (prev.levelShown || !w.levelShown)) continue;
      map.set(k, {
        level: w.level ?? prev?.level ?? null,
        levelShown: w.levelShown ?? null,
        pos: w.pos ?? '',
        dramaTitle: h?.drama?.title ?? '',
      });
    }
  }
  return map;
}

// 単語帳の1語に、履歴から借りた level / levelShown を添える（元のレコードは変えない・保存もしない）。
//   既にレコード自身が持つ値があればそれを優先（将来 ★ 保存時に level を書くようになった時のため）。
export function withWordbookCefr(w, index) {
  if (!w || !index || !index.size) return w;
  const hit = index.get(norm(w.word));
  if (!hit) return w;
  const posClash = !!(w.pos && hit.pos && norm(w.pos) !== norm(hit.pos));
  const out = { ...w };
  if (out.level == null && hit.level && !posClash) out.level = hit.level;
  if (out.levelShown == null && hit.levelShown && !posClash) out.levelShown = hit.levelShown;
  return out;
}
