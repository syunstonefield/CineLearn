// 学習者レベルでの語リストの絞り込み（クライアント依存なしの純関数・2026-10-30 に lib/vocab.js から分離）。
//   クライアント（components/VocabScreen.js・サーバが絞らなかった時）とサーバ（/api/vocab-generate・難易度表の段階で絞る）の両方で使う。
import { getExcludeSet } from './wordlist';

export function toeicToCefr(score) {
  if (!score || score <= 0) return null;
  if (score < 225) return 'A1';
  if (score < 550) return 'A2';
  if (score < 785) return 'B1';
  if (score < 945) return 'B2';
  return 'C1';
}
export function cefrTargetBand(cur, tgt) {
  const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const c = toeicToCefr(cur) || 'A2';
  const t = toeicToCefr(tgt) || order[Math.min(order.indexOf(c) + 1, order.length - 1)];
  const lo = order.indexOf(c);
  const hi = Math.max(order.indexOf(t), lo + 1);
  return `${order[lo]}〜${order[Math.min(hi, order.length - 1)]}`;
}

// 生成済みスーパーセットを学習者レベルで絞る（読み取り時・AI呼び出しなし）。
//  - 既知語の除外（getExcludeSet, スコア依存）
//  - CEFRバンド外フィルタ（複数語/context tier は免除）。levelOf(w) を渡すとその段階を優先（無ければ w.level）
//    ＝サーバで難易度表の段階を使って絞る時（/api/vocab-generate）。返す語オブジェクトは変えない（level は AI のまま）
//  - 字幕内(drama)で minTotal に達していれば余剰 plus を落とす
export function personalizeWords(words, { toeicScore = 0, targetToeicScore = 0, vocabCount = 30, levelOf = null } = {}) {
  const cur = toeicScore > 0 ? toeicScore : 0;
  const upper = targetToeicScore > 0 ? targetToeicScore : cur + 200;
  const targetBand = cefrTargetBand(cur, upper);
  const minTotal = Math.min(50, Math.max(30, vocabCount));

  let json = Array.isArray(words) ? words.slice() : [];

  // 除外語フィルター
  if (toeicScore > 0) {
    const excluded = getExcludeSet(toeicScore);
    json = json.filter((w) => !excluded.has(w.word.toLowerCase()));
  }

  // CEFRバンド外フィルター
  if (cur > 0) {
    const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const band = targetBand.split('〜');
    const loIdx = Math.max(0, order.indexOf(band[0]) - 1);
    const hiIdx = order.indexOf(band[band.length - 1]);
    if (hiIdx >= 0) {
      json = json.filter((w) => {
        // 句動詞・イディオム（複数語）と context（ジャンル専門語）は帯フィルター免除。
        // 単語頻度では測れず、学習者が最も調べる対象なので残す（再現率＝予習の的中率重視）。
        if (/\s/.test(w.word) || w.tier === 'context') return true;
        // 段階は levelOf（サーバの難易度表・品詞一致）を優先し、表に無い語は AI の level（2026-10-30）
        const lv = (levelOf && levelOf(w)) || w.level;
        const li = order.indexOf(String(lv || '').toUpperCase());
        return li === -1 ? true : li >= loIdx && li <= hiIdx;
      });
    }
  }

  // 字幕内(drama)だけで最低総数 minTotal に達していれば字幕外(plus)は足さない。
  // 足りない場合のみ不足分だけ plus を残す（drama が minTotal を超えるのは許容）。
  const dramaCount = json.filter((w) => w.source === 'drama').length;
  const needPlus = Math.max(0, minTotal - dramaCount);
  let keptPlus = 0;
  json = json.filter((w) => {
    if (w.source !== 'plus') return true;
    if (keptPlus < needPlus) {
      keptPlus++;
      return true;
    }
    return false; // 余剰 plus を除外
  });

  return json;
}

// ── サーバで絞る時の補助（2026-10-30・/api/vocab-generate）────────────────────
const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;
};

// クライアントが送る学習者設定 { toeicScore, targetToeicScore, vocabCount } を検証する。不正・無しは null。
export function parsePersonalize(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  return {
    toeicScore: clampInt(p.toeicScore, 0, 990),
    targetToeicScore: clampInt(p.targetToeicScore, 0, 990),
    vocabCount: clampInt(p.vocabCount, 0, 200) || 30,
  };
}

// personalizeWords で残る語の、words における添字（昇順）。語オブジェクトそのものは返さない。
export function selectIndices(words, opts) {
  if (!Array.isArray(words)) return null;
  const kept = new Set(personalizeWords(words, opts));
  const out = [];
  words.forEach((w, i) => kept.has(w) && out.push(i));
  return out;
}
