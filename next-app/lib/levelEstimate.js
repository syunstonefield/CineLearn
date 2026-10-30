// レベル判定（初回の答え firstQuality × 語の固定段階・2026-10-30）。
//   「段階ごとの知ってた率が 50% を切る最初の段階」＝境目。まずは設定のレベル提案に使う想定。
//   ⚠ 点数・率をユーザーに見せる UI は作らない（罪悪感 UI 禁止）。提案の出し方はオーナー確認待ち。
//   語→段階は引数 levelOf で受け取る（表はサーバ専用＝lib/server/wordLevel.js の wordLevel を渡す）。
//   このファイルは表を import しないのでクライアントからも使えるが、levelOf はサーバでしか作れない。
import { CEFR_ORDER } from './wordLevelLookup';

const emptyRow = () => ({ recorded: 0, known: 0, shaky: 0, unknown: 0 });

// srs: { word: { firstQuality, skipped, ... } }（lib/storage.js の SRS と同じ形）または
//      [{ word, firstQuality, skipped }]（Supabase srs_data の行を写したもの）
// levelOf: (word) => { level } | 'B1' | null
// 戻り値: { byLevel: { A1: {recorded, known, shaky, unknown}, ... }, unleveled, recorded }
//   数え方は firstLearnStats と同じ（firstQuality が無い語・skipped の語は数えない。
//   0=知らなかった / 3=うろ覚え / 5=知ってた）。unleveled＝表に無い語（句動詞・口語・固有表現）。
export function firstQualityByLevel(srs, levelOf) {
  const byLevel = Object.fromEntries(CEFR_ORDER.map((lv) => [lv, emptyRow()]));
  let unleveled = 0;
  let recorded = 0;
  const entries = Array.isArray(srs)
    ? srs.map((e) => [e?.word, e])
    : Object.entries(srs || {});
  for (const [word, e] of entries) {
    const q = e?.firstQuality;
    if (q == null || e?.skipped || !word) continue;
    recorded++;
    const hit = typeof levelOf === 'function' ? levelOf(word) : null;
    const lv = typeof hit === 'string' ? hit : hit?.level;
    const row = lv && byLevel[lv];
    if (!row) {
      unleveled++;
      continue;
    }
    row.recorded++;
    if (q < 3) row.unknown++;
    else if (q < 5) row.shaky++;
    else row.known++;
  }
  return { byLevel, unleveled, recorded };
}

// 境目の推定。
//   minWords: 段階ごとに必要な最低語数（足りない段階は判定に使わない＝「不明」）
//   threshold: 知ってた率（known / recorded）がこれ未満の段階を「境目」とみなす
// 戻り値:
//   { boundary: 'B2', reason: 'found', rates: { A1: 0.9, ... } }
//   { boundary: null, reason: 'not_enough_data' | 'above_all', rates, enough: [...] }
//     not_enough_data … 最低語数を満たす段階が1つも無い
//     above_all        … 判定できた段階すべてで知ってた率が threshold 以上（いちばん上の段階まで知っている）
export function estimateBoundary(stats, { minWords = 10, threshold = 0.5 } = {}) {
  const byLevel = stats?.byLevel || {};
  const rates = {};
  const enough = [];
  for (const lv of CEFR_ORDER) {
    const r = byLevel[lv];
    if (!r || r.recorded < minWords) continue;
    rates[lv] = r.known / r.recorded;
    enough.push(lv);
  }
  if (!enough.length) return { boundary: null, reason: 'not_enough_data', rates, enough };
  const boundary = enough.find((lv) => rates[lv] < threshold) || null;
  return boundary
    ? { boundary, reason: 'found', rates, enough }
    : { boundary: null, reason: 'above_all', rates, enough };
}
