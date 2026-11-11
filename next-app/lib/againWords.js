// 「知らなかった語をもう一度」「うろ覚えの語をもう一度」（オーナー決定 2026-11-12・案1・無料）の語の選び方（純関数）。
//   * 最後の答え＝SRS エントリの lastQuality（0＝知らなかった／3＝うろ覚え／5＝知ってた）。
//     利用者が自分で選んだ答えをそのまま使う（計算した「苦手」判定ではない＝2026-10-08 に廃止した isStruggling とは別物）。
//   * lastQuality が無い語（クラウドの last_quality 列が無い・記録前の語）は、復習済みで repetitions=0 なら「知らなかった」とみなす
//     （失敗で repetitions は 0 に戻り、成功では 1 以上になる＝確実に分かる）。うろ覚えはこの方法では分からないので数えない。
//   * 並び＝答えた時刻が新しい順（updatedAt → lastReview）。
// 依存なし（node のテストから読む）。

export const AGAIN_KINDS = ['unknown', 'shaky'];
export const AGAIN_BATCH = 20; // 1回に出す語数

// 'unknown'｜'shaky'｜'known'｜null（未復習・外した語）
export function lastAnswerOf(e) {
  if (!e || e.skipped) return null;
  const q = e.lastQuality;
  if (q != null && Number.isFinite(Number(q))) {
    const n = Number(q);
    if (n < 3) return 'unknown';
    if (n < 5) return 'shaky';
    return 'known';
  }
  if (e.lastReview && Number(e.repetitions) === 0) return 'unknown';
  return null;
}

const stamp = (e) => String(e?.updatedAt || e?.lastReview || '');

// words（{word,...} の配列・重複あり可）から、最後の答えが kind の語を新しい順に。exclude＝今回の続きで既に出した語（小文字）。
export function pickAgainWords(words, srs, kind, { activeKeys = null, exclude = null } = {}) {
  const seen = new Set();
  const out = [];
  for (const w of words || []) {
    const k = String(w?.word || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (activeKeys && !activeKeys.has(k)) continue; // 棚から外した作品だけの語は出さない（今日の復習と同じ範囲）
    if (exclude && exclude.has(k)) continue;
    if (lastAnswerOf(srs?.[k]) !== kind) continue;
    out.push(w);
  }
  out.sort((a, b) => {
    const sa = stamp(srs[String(a.word).toLowerCase()]);
    const sb = stamp(srs[String(b.word).toLowerCase()]);
    return sa < sb ? 1 : sa > sb ? -1 : 0;
  });
  return out;
}
