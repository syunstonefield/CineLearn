// 「入場する ▶」でどのサービスを開くか・単語リスト画面の「配信：」の1行（2026-11-10 オーナー決定・法務条件つき）。
// 依存なしの純関数（node のテストから読む）。取得と端末の覚え書きは lib/serviceAvailability.js。
//   * 載せるのは拡張機能が対応する3サービスだけ（E=1）。TMDB の日本の見放題・広告つき無料・無料の枠だけを見る。
//   * 取得に失敗した・3つのどれにも無い → 1行ごと出さない（JustWatch の出典も出さない）。
//   * 入場：その作品で前に選んだサービス → それ／配信が1つ → それ（自動で開く・覚える）／それ以外 → 選んでもらう。
//     データが取れなかった時は自動で開かない（法務）。
//   * 選んでもらうシートの並び：配信あり → 契約中（設定の契約サービス・B=1）→ その他。

export const EXT_SERVICES = ['Netflix', 'Amazon Prime', 'Disney+']; // lib/tmdb.js の ALL_SERVICES と同じ

// TMDB の provider_id → サービス名（lib/tmdb.js の PROVIDER_MAP のうち拡張が対応する3つ）。
const EXT_PROVIDER_IDS = {
  8: 'Netflix',
  1796: 'Netflix', // Netflix Standard with Ads
  9: 'Amazon Prime', // Amazon Prime Video（JP では free 枠に入ることがある）
  2100: 'Amazon Prime', // Amazon Prime Video with Ads
  337: 'Disney+',
};

// 画面に出す名前（Amazon Prime は「Prime Video」と書く）。
export function serviceLabel(name) {
  return name === 'Amazon Prime' ? 'Prime Video' : name || '';
}

// /watch/providers の応答 → 日本で見放題などに入っている、拡張が対応するサービス（EXT_SERVICES の順）。
export function extServicesFromProviders(data) {
  const jp = data?.results?.JP;
  if (!jp) return [];
  const found = new Set();
  for (const p of [...(jp.flatrate || []), ...(jp.ads || []), ...(jp.free || [])]) {
    const n = EXT_PROVIDER_IDS[p?.provider_id];
    if (n) found.add(n);
  }
  return EXT_SERVICES.filter((n) => found.has(n));
}

// 入場で開く先。avail = { ok, names } | null（未取得）。
//   戻り値 { service, auto }：auto=true は「配信が1つなので自動で決めた」（開いた時に作品ごとに覚える）。null は選んでもらう。
export function entryTarget({ chosen, avail } = {}) {
  if (chosen && EXT_SERVICES.includes(chosen)) return { service: chosen, auto: false };
  if (avail?.ok && avail.names?.length === 1) return { service: avail.names[0], auto: true };
  return null;
}

// 選んでもらうシートの並び（3つ全部・重複なし）。
export function sheetOrder({ avail, contracted } = {}) {
  const has = new Set(avail?.ok ? avail.names || [] : []);
  const mine = new Set(Array.isArray(contracted) ? contracted : []);
  const rank = (n) => (has.has(n) ? 0 : mine.has(n) ? 1 : 2);
  return [...EXT_SERVICES].sort((a, b) => rank(a) - rank(b) || EXT_SERVICES.indexOf(a) - EXT_SERVICES.indexOf(b));
}
