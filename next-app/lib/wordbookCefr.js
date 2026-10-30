// 単語帳の CEFR 目安＝既存の保存語への埋め戻し（2026-10-30・法務 条件3-(i)・表を持たない純関数＝クライアントで使う）。
//   新しく保存する語は保存時に単語リストの値（表 levelShown・AI level・元 listSource）を記録へ写す（VocabScreen・条件1）。
//   それより前に保存した語は値を持たないので、端末の予習の記録（cl_history）に残る「同じ作品・同じ話」の単語リストに
//   同じ語があれば、その値を写して保存する（一度きり）。単語帳の画面は保存された値だけを出す（lib/cefrHint.js）。
//   ⚠ サーバへは何も問い合わせない。端末から送った語を表で引く経路は作らない（法務 条件1・3・6）。
//   品詞: 表の段階は品詞ごとなので、保存語と履歴の両方に品詞があって食い違う語には写さない。

const norm = (s) => String(s ?? '').toLowerCase().trim();
const defaultSameTitle = (a, b) => !!a && !!b && norm(a) === norm(b);

// 埋め戻す差分を求める: [{ word, patch: { level?, levelShown?, listSource? } }]
//   words   = 単語帳の保存語（getWordbookWords）
//   history = loadHistory()
//   sameTitle(a, b) = 作品名の同一判定（アプリは lib/words.js の sameWorkTitle を渡す）
export function cefrPatchesFromHistory(words, history, { sameTitle = defaultSameTitle } = {}) {
  const out = [];
  const entries = (history || []).filter((h) => h?.drama?.title && Array.isArray(h.words));
  for (const w of words || []) {
    if (!w?.word || /\s/.test(norm(w.word))) continue; // 句動詞・イディオムは出さない（lib/cefrHint.js と同じ）
    if (w.levelShown || w.level) continue; // 既に写してある
    if (!w.dramaTitle) continue; // 作品が分からない語は「その話の単語リスト」を特定できない
    const k = norm(w.word);
    let hit = null;
    for (const h of entries) {
      if (!sameTitle(h.drama.title, w.dramaTitle)) continue;
      // TV は同じ話だけ。保存語に S/E が無い（映画・話数不明）時は作品一致だけで見る
      if (w.season != null && w.episode != null && (h.season !== w.season || h.episode !== w.episode)) continue;
      const hw = h.words.find((x) => norm(x?.word) === k);
      if (!hw) continue;
      if (w.pos && hw.pos && norm(w.pos) !== norm(hw.pos)) continue; // 品詞違いは写さない
      if (!hit || (!hit.levelShown && hw.levelShown)) hit = hw;
    }
    if (!hit) continue;
    const patch = {};
    if (hit.levelShown) patch.levelShown = hit.levelShown;
    if (hit.level) patch.level = hit.level;
    if (hit.source === 'drama' || hit.source === 'plus') patch.listSource = hit.source;
    if (Object.keys(patch).length) out.push({ word: w.word, patch });
  }
  return out;
}

// 差分を保存して、写した後の配列を返す（何も無ければ null）。save は lib/words.js の saveWordTranslation。
export async function backfillCefrFromHistory(words, history, profileId, { sameTitle, save } = {}) {
  const patches = cefrPatchesFromHistory(words, history, { sameTitle });
  if (!patches.length) return null;
  const byWord = new Map(patches.map((p) => [norm(p.word), p.patch]));
  if (typeof save === 'function') {
    for (const p of patches) {
      try {
        await save(profileId, p.word, p.patch);
      } catch {
        /* 保存できなくても画面には写した値を出す（次回また試す） */
      }
    }
  }
  return (words || []).map((w) => {
    const patch = byWord.get(norm(w?.word));
    return patch ? { ...w, ...patch } : w;
  });
}
