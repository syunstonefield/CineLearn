// 「語 → 意味のカテゴリ（と並びの番号）」の表を端末で引く（関連語・2026-11-18・⑦裏側の持ち物）。
//   表は public/cat-words.json（seed/build-cat-table.mjs で作る・語とコードと番号だけ・作品に結びつかない）。
//   ★語をサーバーへ送らない。表をまるごと1回取り、端末の中で引く。取れなければ表なしで動く（今までどおりの並び）。
//   値の形: 'emotion.anger' または 'emotion.anger.12'（12＝その小の中で意味の近い語が隣り合う並びの番号）・'other'。

import { CAT_VERSION, CAT_OTHER, parseCatKey } from './relCategories.js';

export const CAT_TABLE_URL = '/cat-words.json';

let table = null;
let loading = null;

// 表を取る（1回だけ・失敗しても投げない）。アプリを開いた時に AppProvider から先に呼んでおく。
export function loadCatTable(fetchImpl = typeof fetch === 'function' ? fetch : null) {
  if (table) return Promise.resolve(table);
  if (!fetchImpl) return Promise.resolve(null);
  if (!loading) {
    loading = Promise.resolve()
      .then(() => fetchImpl(CAT_TABLE_URL))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => {
        if (j && j.catv === CAT_VERSION && j.words && typeof j.words === 'object') table = j;
        return table;
      })
      .catch(() => null)
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

// いま手元にある表（まだ取れていなければ null）。
export function catTableNow() {
  return table;
}

// テスト用（表を差し替える・null で消す）。
export function setCatTable(t) {
  table = t && t.words ? t : null;
}

// 語 → { cat, sub, pos }（pos＝並びの番号・無ければ null）。表に無い・表が無い → null。
export function tableEntry(word, t = table) {
  const v = t?.words?.[String(word || '').trim().toLowerCase()];
  if (!v) return null;
  const [cat, sub, n] = String(v).split('.');
  if (cat === CAT_OTHER) return { cat: CAT_OTHER, sub: '', pos: null };
  const p = parseCatKey(`${cat}.${sub}`);
  if (p.cat === CAT_OTHER) return null;
  const pos = n !== undefined && /^\d+$/.test(n) ? Number(n) : null;
  return { cat: p.cat, sub: p.sub, pos };
}
