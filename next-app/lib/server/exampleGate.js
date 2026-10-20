// /api/example（拡張のクリック保存のバックフィル）の入力検証と OpenSubtitles DL 適格性（2026-10-13 セキュリティ監査 H2）。
//
// 背景: /api/example の層2は認証なしで、body の tmdbId/season/episode をそのまま採り、raw 未取得なら OS から DL していた。
//   未取得の話を回すだけで IP 1つ・約12分で共有の日次 DL 枠（700）が尽き、その UTC 日は全員の生成・例文補完が os_quota になる
//   （OS 枠は金で買えない資源）。manual モードだけはログイン必須＋人/日5話の締めがあった。
// 対策（manual 以外の層2）:
//   ① S/E の範囲チェック（parseSeasonEpisode）
//   ② DL の適格性（exampleDlEligible）: その話の vocab_cache 行がある（＝正規の生成済み）か、作品がカタログ内
//   ③ DL 専用バケット（route 側・IP/日・failClosed）
// seed（素の Node）・node:test から import できるよう node:* と相対 import 以外は使わない。

import { isInCatalog } from './vocabCache.js';
import { phraseContentTokenCount } from '../subtitles.js';

// 照合する語の上限（2026-10-20 /decide・ReDoS 対策）。フレーズの正規表現は語の間に0〜2語を許すため、
//   語数が増えると一致しない時の試行が指数的に増える（同じ語を並べた細工キューで 12語=1.17秒/キュー を実測）。
//   5語なら形式崩れで2000語の巨大キューになっても最悪 14ms。句動詞・慣用句は5語に収まる
//   （keep an eye on someone＝埋め草を除くと keep/eye/on の3語）。
export const EXAMPLE_WORD_MAX_CHARS = 64;
export const EXAMPLE_WORD_MAX_TOKENS = 5;
// 語の形の問題 → 'too_long' | null。route は found:false で返す（例文なしで保存＝従来の失敗と同じ扱い）。
export function exampleWordProblem(word) {
  const w = String(word || '');
  if (w.length > EXAMPLE_WORD_MAX_CHARS) return 'too_long';
  if (phraseContentTokenCount(w) > EXAMPLE_WORD_MAX_TOKENS) return 'too_long';
  return null;
}

export const EXAMPLE_SEASON_MAX = 100;
export const EXAMPLE_EPISODE_MAX = 500;

// 非負整数（数値 or 数字だけの文字列）→ 数値、それ以外 → NaN。'1.5'・' '・true・'1e2' は NaN（Number() の緩さを避ける）。
function nonNegInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : NaN;
  if (typeof v === 'string' && /^\d{1,6}$/.test(v.trim())) return Number(v.trim());
  return NaN;
}

// body の season/episode → { ok:true, hasSE, season, episode } | { ok:false }。
//   両方が非空のときだけ TV（hasSE）＝従来どおり（拡張の getEpisodeContext は映画/未検出で season=null）。
//   TV は整数・season 0〜100・episode 0〜500。範囲外・非整数は ok:false（route は bad_request）。
export function parseSeasonEpisode(body) {
  const present = (v) => v != null && v !== '';
  const hasSE = present(body?.season) && present(body?.episode);
  if (!hasSE) return { ok: true, hasSE: false, season: 0, episode: 0 };
  const season = nonNegInt(body.season);
  const episode = nonNegInt(body.episode);
  if (!(season <= EXAMPLE_SEASON_MAX) || !(episode <= EXAMPLE_EPISODE_MAX)) return { ok: false }; // NaN もここで落ちる
  return { ok: true, hasSE: true, season, episode };
}

// 層2で OS から DL してよい話か。
//   hasVocabRow: 層1で読んだ vocab_cache 行が存在するか（route は readVocabRow の結果を再利用＝再クエリしない）
//   それ以外はカタログ照合（/api/vocab-generate の匿名ゲートと同じ isInCatalog・ゲート無効時は常に true・DB 不調は fail-open）。
//   catalogCheck は単体テスト用の差し替え口。
export async function exampleDlEligible({ hasVocabRow, tmdbId }, { catalogCheck = isInCatalog } = {}) {
  if (hasVocabRow) return true;
  return !!(await catalogCheck(tmdbId));
}
