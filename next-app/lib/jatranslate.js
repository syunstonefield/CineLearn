// 例文（短文）の英→日訳を /api/translate 経由で取得し端末キャッシュする（単語帳の例文和訳表示用）。
// /api/translate は単語/短句（≤100字）専用。長文や鍵未設定時は null（例文和訳なしで表示）。
// サーバー側も translation_cache に保存するが、再表示の round-trip を減らすため端末にもキャッシュする。
const CACHE_KEY = 'cl_ja_sentence_cache_v1';

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function saveCache(c) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export async function fetchJa(text) {
  const t = (text || '').trim();
  if (!t || t.length > 100) return null; // /api/translate は短句のみ
  const key = t.toLowerCase();
  const cache = loadCache();
  if (key in cache) return cache[key];
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: t }),
    });
    const data = await res.json();
    const ja = data?.ja || null;
    cache[key] = ja; // null もキャッシュ（鍵無し/長文の再試行を避ける）
    saveCache(cache);
    return ja;
  } catch {
    return null;
  }
}
