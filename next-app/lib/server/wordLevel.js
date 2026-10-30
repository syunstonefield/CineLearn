// 語ごとの固定難易度表（サーバ専用・2026-10-30 オーナー選択肢1・法務 条件付きOK）。
//   CEFR-J Wordlist 1.6（A1〜B2）＋ Octanove Vocabulary Profile C1/C2 1.0（CC BY-SA 4.0）。
//   原本→JSON の変換は scripts/build-word-levels.py。出典ごとに別ファイル（法務 条件2）。
//
// ⚠ 表はユーザーに表示・配布しない（法務 条件4）。'server-only' でクライアントからの import を
//   ビルドエラーにする。クライアントに返してよいのは「その人の語の段階」や集計結果までで、表そのものではない。
// ⚠ 使い道は今のところレベル判定（firstQuality × 段階 → lib/levelEstimate.js）だけ。
//   生成（vocab_cache の level）・personalizeWords の帯フィルタには使わない（オーナー判断 2026-10-30）。
import 'server-only';
import cefrj from '../data/cefrj-wordlist-1.6.json' with { type: 'json' };
import octanove from '../data/octanove-c1c2-1.0.json' with { type: 'json' };
import { createWordLevelLookup } from '../wordLevelLookup';

export const WORD_LEVEL_TABLES = [
  { id: 'cefrj', version: '1.6', retrieved: cefrj._retrieved, levels: cefrj.levels },
  { id: 'octanove', version: '1.0', retrieved: octanove._retrieved, levels: octanove.levels },
];

// wordLevel('running') → { level: 'A1', src: 'cefrj', via: 'lemma', key: 'run' } / 表に無い語は null
export const wordLevel = createWordLevelLookup(WORD_LEVEL_TABLES);
