// 語ごとの固定難易度表（サーバ専用・2026-10-30 オーナー選択肢1・法務 条件付きOK）。
//   CEFR-J Wordlist 1.6（A1〜B2）＋ Octanove Vocabulary Profile C1/C2 1.0（CC BY-SA 4.0）。品詞ごとの段階を持つ。
//   原本→JSON の変換は scripts/build-word-levels.py。出典ごとに別ファイル（法務 条件2）。
//
// ⚠ 語ごとの段階は単語リストの語にだけ付けて返してよい（2026-10-30 法務 条件付きOK）。表全体・任意の語の照会・
//   一覧の書き出しは出さない。'server-only' でクライアントからの import をビルドエラーにする（表 JSON は送らない）。
// 使い道: ① レベル判定（firstQuality × 段階 → lib/levelEstimate.js・品詞を問わず易しい方）
//         ② 単語リストの絞り込み（下の selectForLearner・品詞一致・原形化なし・2026-10-30 オーナー決定）
//   vocab_cache の level（AI 判定）は書き換えない。
// ⚠ 法務のルール（2026-10-30・82ce4c0 の回答）:
//     1. 表の作り方（変換・正規化・持つ列）を変えたら、JSON の _modified・repo 直下の THIRD_PARTY_NOTICES.md・
//        利用規約「第三者データ」節の3か所を同時に直す（文言は ⑤ 検索・半券・設定・その他 部門）。
//     2. 表の段階の出し方を広げる変更は事前に法務へ（2026-10-30 法務 条件4）。
import 'server-only';
import cefrj from '../data/cefrj-wordlist-1.6.json' with { type: 'json' };
import octanove from '../data/octanove-c1c2-1.0.json' with { type: 'json' };
import { createWordLevelLookup, makeFilterLevelOf, attachDisplayLevels } from '../wordLevelLookup';
import { selectIndices } from '../personalize';
export { parsePersonalize } from '../personalize';

export const WORD_LEVEL_TABLES = [
  { id: 'cefrj', version: '1.6', retrieved: cefrj._retrieved, levels: cefrj.levels },
  { id: 'octanove', version: '1.0', retrieved: octanove._retrieved, levels: octanove.levels },
];

// wordLevel('running') → { level: 'A1', src: 'cefrj', via: 'lemma', key: 'run' } / 表に無い語は null
export const wordLevel = createWordLevelLookup(WORD_LEVEL_TABLES);

// ── 単語リストの絞り込み（2026-10-30 オーナー決定・サーバで絞る方式）──────────────
//   クライアントの personalizeWords（AI の level で絞る）の代わりに、サーバが難易度表の段階
//   （品詞一致・原形化なし。表に無い語は AI の level）で絞り、**表示する語の番号**だけを返す。
//   語オブジェクトは変えない（level は AI のまま）＝表の値はサーバの外に出ない（法務 条件4）。
//   全語も今まで通り返す（例文の和訳の行ごと埋め戻し runFillExampleJa が行の全語を使うため）。
//   戻すとき: Vercel の環境変数 WORD_LEVEL_FILTER=off を入れて再デプロイ → selected を返さない
//   ＝クライアントは従来どおり自分で AI の level で絞る。
export const WORD_LEVEL_FILTER_ENABLED = process.env.WORD_LEVEL_FILTER !== 'off';
const filterLevelOf = makeFilterLevelOf(wordLevel);

// words（wordsForServe 済み）と学習者設定（parsePersonalize 済み）から、表示する語の番号（words の添字・昇順）。
// 絞り込みが無効・設定が無い時は null（クライアントが従来どおり自分で絞る）。
export function selectForLearner(words, personalize) {
  if (!WORD_LEVEL_FILTER_ENABLED || !personalize) return null;
  return selectIndices(words, { ...personalize, levelOf: filterLevelOf });
}

// ── 単語リストの「CEFR目安」表示の値（2026-10-30 オーナー (A) で GO・法務 条件付きOK）──────────
//   既定（table）… (A) 字幕から出た語のうち、表で品詞一致して引けた語に表の段階 levelShown を添えて返す
//                  （絞り込みと表示が一致）。それ以外の語は画面が AI の level を淡く出す。
//   WORD_LEVEL_DISPLAY=ai … (B) 何も添えない（戻す時。Vercel の環境変数＋再デプロイ）
//   法務 条件1: 付けるのは単語リスト生成の応答の、字幕から出た語だけ。任意の語の照会 API・段階一覧の書き出し・
//   単語帳の手入力語への付与は作らない（作るなら事前に法務へ）。共有キャッシュ（vocab_cache）には書かない。
export const WORD_LEVEL_DISPLAY = process.env.WORD_LEVEL_DISPLAY === 'ai' ? 'ai' : 'table';
export function withDisplayLevels(words) {
  if (WORD_LEVEL_DISPLAY !== 'table') return words;
  return attachDisplayLevels(words, filterLevelOf);
}
