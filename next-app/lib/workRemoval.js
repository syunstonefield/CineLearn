// コレクションから作品を消去する（オーナー 2026-11-07）。依存なしの純関数（node のテストから読む）。
//   消すのは「学習していない、かつ他の単語リストにも単語帳にもない語」だけ。学習した語は意味・例文・出所ごと残す
//   （単語リストの行を丸ごと消すと、覚えた語が復習にも円にも出なくなるため）。
//   学習した＝復習で1回でも採点した（SRS に記録・「知ってる」で飛ばしただけは除く）か、単語帳にある。
//   予習カードを見ただけ・クイズに答えただけの語は語ごとの記録が無いので「学習していない」（オーナー決定）。
//   語は小文字で比べる（activeWordKeys と同じ）。活用形は別の語。
//   作品名は履歴の drama.title と完全一致（deleteAllHistoryForWork と同じ。部分一致だと別作品を巻き込む）。

const keyOf = (w) => String(w?.word || '').toLowerCase();

// 消した印（作品名 → { on, at }）。端末間は作品ごとに at が新しい方（cl_archived と同じ規則）。
//   もう一度開くと on:false（openDrama）。表示は印の on で隠す。
export const REMOVED_WORKS_KEY = 'cl_removed_works';
// 円の「出会った」の最高値を、消去した時点から数え直す印 { at, met }（lib/rings.js settleRingValues）。
export const RING_MET_RESET_KEY = 'cl_ring_met_reset';

export function isGraded(e) {
  return !!e && !e.skipped;
}

// 作品を消去したら何がどうなるか（件数と、書き換える履歴）。
//   isLearned / isMastered は lib/storage.js のものを渡す（ここを依存なしに保つため）。
//   counts.removed … 消える語（このリストにだけある・学習していない・「知ってる」で飛ばしていない）
//   counts.shared  … 学習していないが他の作品のリストにもある語（そちらに残る）
//   counts.studied … 採点した語（learned・mastered はその内訳）
//   counts.wordbook… 採点はしていないが単語帳にある語
//   rowsUpdate（学習した語だけ残した行・drama.prunedAt 付き）と rowsDelete（何も残らない行の id）。
export function planWorkRemoval({ title, history, myWords, srs, isLearned, isMastered, now = Date.now() }) {
  const wordbook = new Set((myWords || []).map(keyOf).filter(Boolean));
  const own = [];
  const otherKeys = new Set();
  (history || []).forEach((h) => {
    if (h?.drama?.title === title) own.push(h);
    else (h?.words || []).forEach((w) => keyOf(w) && otherKeys.add(keyOf(w)));
  });
  const counts = { removed: 0, shared: 0, studied: 0, learned: 0, mastered: 0, wordbook: 0 };
  const seen = new Set();
  own.forEach((h) =>
    (h.words || []).forEach((w) => {
      const k = keyOf(w);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const e = srs?.[k];
      if (isGraded(e)) {
        counts.studied++;
        if (isLearned(e)) counts.learned++;
        if (isMastered(e)) counts.mastered++;
      } else if (wordbook.has(k)) counts.wordbook++;
      else if (e?.skipped) return; // 「知ってる」で飛ばした語はもともと数に入らない
      else if (otherKeys.has(k)) counts.shared++;
      else counts.removed++;
    })
  );
  const keep = (w) => isGraded(srs?.[keyOf(w)]) || wordbook.has(keyOf(w));
  const rowsUpdate = [];
  const rowsDelete = [];
  const next = [];
  (history || []).forEach((h) => {
    if (h?.drama?.title !== title) return void next.push(h);
    const words = h.words || [];
    const kept = words.filter(keep);
    if (!kept.length) return void rowsDelete.push(h.id);
    if (kept.length === words.length) return void next.push(h);
    // 印は drama の中に置く（pullFromCloud は history の列を名前で拾い直すので行の直下の項目は消える。drama は丸ごと残る）。
    const row = { ...h, words: kept, drama: { ...h.drama, prunedAt: now } };
    rowsUpdate.push(row);
    next.push(row);
  });
  return {
    title,
    episodes: own.length,
    counts,
    rowsUpdate,
    rowsDelete,
    nextHistory: next,
    changed: rowsUpdate.length + rowsDelete.length > 0,
  };
}

// 語を抜いた行か（もう一度開いた時は保存済みとして出さず、作り直す・VocabScreen）。
export function isPrunedRow(h) {
  return !!h?.drama?.prunedAt;
}

// 消した印の読み書き（作品名の配列 ⇔ 印の地図）。旧形式は無い（新しいキー）。
export function removedTitlesOf(map) {
  return Object.entries(map && typeof map === 'object' ? map : {})
    .filter(([, v]) => v?.on)
    .map(([t]) => t);
}
export function withRemoved(map, title, on, at = Date.now()) {
  return { ...(map && typeof map === 'object' ? map : {}), [title]: { on: !!on, at } };
}

// 円の「出会った」の値。消去したことがあれば、その時点からの最高値と今の値の大きい方。
//   無ければ従来どおり台帳（cl_stats_daily）の最高値と今の値の大きい方。
//   消去の時の起点は「直前に見えていた値 − 消えた語数」（metAfterRemoval）。今の値（端末の履歴は最大50話）から
//   数え直すと、50話より前に出会った語まで一緒に減ってしまうため。
export function ringMetValue({ current, highWater, reset }) {
  const cur = Number(current) || 0;
  if (reset && Number.isFinite(reset.at)) return Math.max(Number(reset.met) || 0, cur);
  return Math.max(Number(highWater) || 0, cur);
}
export function metAfterRemoval(shownBefore, removed) {
  return Math.max(0, (Number(shownBefore) || 0) - (Number(removed) || 0));
}

// 確認画面の文（責めない・件数つき・オーナー 2026-11-07「消去」で統一）。0 の項目は書かない。
export function removalConfirmLines(c) {
  const lines = [
    `消去する語：${c.removed}語` + (c.shared ? `（ほかの作品の単語リストにもある ${c.shared}語は残ります）` : ''),
  ];
  const keep = [];
  if (c.studied) {
    const inner = [c.learned && `覚えた ${c.learned}`, c.mastered && `マスター ${c.mastered}`].filter(Boolean);
    keep.push(`学習した ${c.studied}語` + (inner.length ? `（${inner.join('・')} を含む）` : ''));
  }
  if (c.wordbook) keep.push(`単語帳の ${c.wordbook}語`);
  lines.push(keep.length ? `残る語：${keep.join('と、')}。復習もこれまでどおり続きます` : '残る語：ありません');
  // あゆみの円の「出会った」は減るので「あゆみの記録はそのまま」とは書かない（ホーム・あゆみ部門 2026-11-07）。
  lines.push('学習した日・EXP・覚えた・マスターの記録はそのままです（あゆみの「出会った」は消去した語の分だけ減ります）');
  lines.push('作品をもう一度開けば、単語リストはいつでも作り直せます');
  return lines;
}

// もう一度開いた作品で外す印の作品名（棚から外す cl_archived・消去 cl_removed_works の両方に使う）。
//   一覧を隠す側は作品名の揺れ（邦題/英題）を sameTitle で寄せているので、外す側も同じ寄せ方にする
//   （完全一致だけだと、隠れたまま外れない作品が出る）。
export function titlesToReopen(markedTitles, title, sameTitle = (a, b) => a === b) {
  if (!title) return [];
  return (markedTitles || []).filter((t) => t === title || sameTitle(t, title));
}
