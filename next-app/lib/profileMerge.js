// プロフィール（設定）同期のマージ規則（案A: 新しい方が勝つ＋myDramas は合体）。
// 依存ゼロの純関数に隔離して、Node 単体でも検証できるようにする。
//
// 背景: pullFromCloud はかつて cl_profiles をクラウドで無条件上書きしていた。
// push（saveProfiles→pushProfiles）が失敗していた場合、次回起動時に
// 「古いクラウドが新しいローカルを丸ごと潰す」＝設定・マイリスト消失が起きる。
// 対策: 更新時刻を比べて新しい方（winner）を採用し、負けた側（loser）からは
//   - winner に無いプロフィール（id 単位）を補完
//   - 各プロフィールの myDramas を合体（作品消失だけは絶対に防ぐ）
// する。スカラー設定（レベル等）は winner のものが丸ごと勝つ（ブロブ LWW）。

// 設定の最終更新時刻を持つ localStorage キー（storage.js / supabase.js の両方から参照。
// storage.js は supabase.js を import しているため、循環を避けてここに置く）。
export const PROFILES_AT_KEY = 'cl_profiles_updated_at';

// myDramas の合体。a を優先しつつ、b にしか無い作品（title 同定）を後ろに足す。
// 同一タイトルは a 側優先だが、a に無い/null のフィールドは b から穴埋めする。
// （古いクラウド形が winner になった時に tmdbId/posterPath が消える事故の再発防止・
//   2026-07-03 実測: tmdbId 消失→半券の総話数が全作品「—」化）
export function unionDramas(a, b) {
  const bList = Array.isArray(b) ? b : [];
  const out = (Array.isArray(a) ? a : []).map((d) => {
    if (!d || !d.title) return d;
    const other = bList.find((x) => x && x.title === d.title);
    if (!other) return d;
    const merged = { ...d };
    Object.keys(other).forEach((k) => {
      if (merged[k] == null && other[k] != null) merged[k] = other[k];
    });
    return merged;
  });
  bList.forEach((d) => {
    if (d && d.title && !out.some((x) => x && x.title === d.title)) out.push(d);
  });
  return out;
}

// プロフィール配列のマージ。winner（新しい方）を土台に、
// loser の myDramas を合体・loser にしか無いプロフィールを補完する。
export function mergeProfileArrays(winner, loser) {
  const w = Array.isArray(winner) ? winner : [];
  const l = Array.isArray(loser) ? loser : [];
  const out = w.map((p) => {
    const other = l.find((x) => x && x.id === p.id);
    if (!other) return p;
    const merged = unionDramas(p.settings?.myDramas, other.settings?.myDramas);
    // ⚠長さ比較で「変更なし」を判定してはいけない：フィールド穴埋め（tmdbId補完等）は
    // 件数を変えないため捨てられてしまう（2026-07-03 の総話数「—」化の一因）。
    if (JSON.stringify(merged) === JSON.stringify(p.settings?.myDramas || [])) return p;
    return { ...p, settings: { ...(p.settings || {}), myDramas: merged } };
  });
  // loser にしか無いプロフィールは消さずに補完（デバイスA/Bで別々に作った場合）
  l.forEach((p) => {
    if (p && p.id && !out.some((x) => x && x.id === p.id)) out.push(p);
  });
  return out;
}

// 「クラウドとローカル、どちらを winner にするか」の判定。
//   - ローカルが空 → クラウド（初回ログイン/新端末の取り込み）
//   - どちらかの時刻が欠けている → ローカル優先（上書き事故を避ける保守側）
//   - 時刻比較（ISO 文字列の辞書順＝時刻順）でクラウドが真に新しい時だけクラウド
export function cloudWins(localProfiles, localAt, cloudAt) {
  const hasLocal = Array.isArray(localProfiles) && localProfiles.length > 0;
  if (!hasLocal) return true;
  if (!cloudAt) return false;
  if (!localAt) return false;
  return cloudAt > localAt;
}
