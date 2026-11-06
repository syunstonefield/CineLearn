// 作品の「最近触った」時刻（ミリ秒）。続きから学習・復習の作品一覧の並びに使う（オーナー 2026-11-07）。
// 依存なしの純関数（node のテストから読む）。どれも同期されるデータなので、別の端末でも同じ並びになる。
//   * 単語リストを作った・作り直した日（履歴の date）
//   * その作品のリストの語を復習した時刻（SRS の updatedAt・無ければ lastReview の日付）
//   * その作品で拡張から語を保存した時刻（単語帳の createdAt・無ければ savedAt の日付）
//   * 単語リストを開いた・棚から外す／消去から戻した時刻（myDramas の touchedAt）
// 以前は「単語リストを作った日」だけで並べていたので、復習しても順番が変わらなかった。
const dayMs = (s) => {
  const m = String(s || '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return 0;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : 0;
};
const isoMs = (s) => {
  const t = Date.parse(String(s || ''));
  return Number.isFinite(t) ? t : 0;
};

export function workRecency({ history, srs, myWords, myDramas, sameTitle = (a, b) => a === b } = {}) {
  const m = new Map();
  const bump = (t, ms) => {
    if (!t || !(ms > 0)) return;
    if (ms > (m.get(t) || 0)) m.set(t, ms);
  };
  (history || []).forEach((h) => {
    const t = h?.drama?.title;
    if (!t) return;
    bump(t, dayMs(h.date));
    (h.words || []).forEach((w) => {
      const e = srs?.[String(w?.word || '').toLowerCase()];
      if (!e || e.skipped) return;
      bump(t, Math.max(isoMs(e.updatedAt), dayMs(e.lastReview)));
    });
  });
  // 単語帳と myDramas の作品名は邦題/英題で揺れるので、履歴の作品名へ寄せる。
  const titles = [...m.keys()];
  const canon = (t) => (t ? titles.find((x) => x === t) || titles.find((x) => sameTitle(x, t)) || t : null);
  (myWords || []).forEach((w) => bump(canon(w?.dramaTitle), Math.max(isoMs(w?.createdAt), dayMs(w?.savedAt))));
  (myDramas || []).forEach((d) => bump(canon(d?.title), Number(d?.touchedAt) || 0));
  return m;
}

// 並べる時の比べ方（新しい順）。recency に無い作品は fallbackMs（最終学習日など）で比べる。
export function byRecency(recency, titleOf, fallbackMs = () => 0) {
  return (a, b) => (recency.get(titleOf(b)) ?? fallbackMs(b)) - (recency.get(titleOf(a)) ?? fallbackMs(a));
}
