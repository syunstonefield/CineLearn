// あゆみ「段階ごとの覚えた語」（CEFR 目安別・案A 横棒・オーナー 2026-11-05 ＝ 10/8 の「レベル別は出さない」を上書き）。
//   docs/design-paid-features-2026-10-08.md「上書き（2026-11-05）」・reports/journey-cefr-2026-11-05/。
//   数え方:
//     母数＝3重の円と同じ collectRingWords（履歴の生成語＋単語帳の保存語・語で1つ・skipped 除外）。
//     覚えた＝state が learned / mastered（isLearned・マスターを含む）。マスターは内数。
//     段階＝単語リスト・単語帳と同じ規則（lib/cefrHint.js cefrHintOf）: 表の levelShown → AI の level → 句動詞など複数語は無し。
//     保存語（level を持たない）は単語帳と同じく端末の cl_history から同じ語（品詞一致）の値を借りる（lib/wordbookCefr.js・
//     法務 2026-10-30 追補で承認。サーバへは問い合わせない）。
//   出さないもの（罪悪感 UI 禁止・法務の表現制限）: 割合・「残り」・表の語数との比較・本人の段階（「あなたは B1」）。
//   棒の長さ＝いちばん多い段階を 1 とした相対値（分母なし・並び順に依存しない）。
//   並び＝上から C2→C1→B2→B1→A2→A1（オーナー 2026-11-05「A1 が一番下で C2 を一番上に」）。集計や相対値は順序に依存しない。
//   純関数（テスト: scripts/journeyCefr.test.mjs）。画面は components/VocabJourneyScreen.js の CefrCard が描くだけ。
import { CEFR_ORDER } from './wordLevelLookup';
import { cefrHintOf } from './cefrHint';
import { cefrIndexFromHistory, withWordbookCefr } from './wordbookCefr';

const isLearnedState = (w) => w?.state === 'learned' || w?.state === 'mastered';

// words: collectRingWords の出力／history: loadHistory()（保存語の段階を借りる元）
// 戻り値: {
//   rows: [{ level: 'C2', learned, mastered, frac, fracMastered }] × C2→A1 の順（表示順・frac は最多の段階を 1 とした相対値）
//   unleveled: 覚えたが段階の付かない語数（句動詞・言い回し・履歴に無い保存語）
//   learned / mastered: 覚えた・マスターの合計（段階の有無を問わない＝円の現在値と同じ数え方）
//   table / ai: 段階の出どころの内訳（表／AI 推定）
//   show: カードを出すか（覚えた語が1語でもあれば出す。段階が1つも付かない時は出さない）
// }
export function countLearnedByLevel(words, history) {
  const index = cefrIndexFromHistory(history || []);
  const byLevel = Object.fromEntries(CEFR_ORDER.map((lv) => [lv, { learned: 0, mastered: 0 }]));
  let unleveled = 0;
  let learned = 0;
  let mastered = 0;
  let table = 0;
  let ai = 0;
  (words || []).forEach((w) => {
    if (!isLearnedState(w)) return;
    learned++;
    const m = w.state === 'mastered';
    if (m) mastered++;
    const hint = cefrHintOf(withWordbookCefr(w, index));
    if (!hint) {
      unleveled++;
      return;
    }
    byLevel[hint.level].learned++;
    if (m) byLevel[hint.level].mastered++;
    if (hint.ai) ai++;
    else table++;
  });
  const max = Math.max(0, ...CEFR_ORDER.map((lv) => byLevel[lv].learned));
  const rows = [...CEFR_ORDER].reverse().map((lv) => ({
    level: lv,
    learned: byLevel[lv].learned,
    mastered: byLevel[lv].mastered,
    frac: max ? byLevel[lv].learned / max : 0,
    fracMastered: max ? byLevel[lv].mastered / max : 0,
  }));
  return { rows, unleveled, learned, mastered, table, ai, show: learned > 0 && max > 0 };
}
