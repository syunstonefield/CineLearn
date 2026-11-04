// 初回体験の作品のうち、いま出せるもの（2026-11-05・docs/design-first-run-trial-2026-11-05.md 法務 F）。
//   体験の作品は画面側の固定データだが、権利者の要請で**デプロイなしに**外せるよう、catalog の enabled を正とする。
//   外す手順＝catalog の該当行を enabled=false にする1行。画面（作品・予習部門）は /api/trial-catalog の enabled に
//   無い作品を隠し、API が失敗した時は全部出す（その後の vocab-generate cacheOnly が blocked で止める＝二重の守り）。
//   ID は体験の6作に固定＝この API を一般のカタログ照会に使えないようにする。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。
import { sbSelect } from './vocabCache.js';

// 体験の作品（オーナー確定 2026-11-05）: SUITS／Friends／Stranger Things／Iron Man（映画）＋文字リンクの Emily in Paris／プラダを着た悪魔
export const TRIAL_TMDB_IDS = Object.freeze([37680, 1668, 66732, 1726, 82596, 350]);

// catalog の行（{ tmdb_id, enabled }）から、体験の作品で enabled=true の ID だけを元の並びで返す（純関数・テスト用）。
export function enabledTrialIds(rows, ids = TRIAL_TMDB_IDS) {
  const on = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = parseInt(r?.tmdb_id, 10);
    if (id && r?.enabled === true) on.add(id);
  }
  return ids.filter((id) => on.has(id));
}

// 本番の catalog を読む（service_role・列は tmdb_id/enabled だけ・書かない）。不調は ok:false（画面は全部出す）。
export async function readTrialCatalog({ ids = TRIAL_TMDB_IDS, fetchImpl = fetch } = {}) {
  const q = await sbSelect(`catalog?tmdb_id=in.(${ids.join(',')})&select=tmdb_id,enabled`, { fetchImpl });
  if (!q.ok) return { ok: false, enabled: [] };
  return { ok: true, enabled: enabledTrialIds(q.rows, ids) };
}
