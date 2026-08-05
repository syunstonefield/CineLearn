// 例文（1文）の英→日訳。単語帳・単語リストの例文和訳表示用。
// 経路: ①/api/translate（DeepL/Azure・短句≤100字・安い） → 失敗/null なら
//       ②/api/claude mode:'sentence'（Haiku・長文可・サーバ側で共有キャッシュ）。
// 2026-08-05: 本番の翻訳API鍵が失効し ①が恒常的に null を返す状態になっていた（実測）。
//   Anthropic 鍵は生きているため②を代替経路として追加。あわせて「null を永続キャッシュして
//   二度と再試行しない」焼き付けを廃止（成功だけ永続・失敗は短期TTLで再試行可能に）。
const CACHE_KEY = 'cl_ja_sentence_cache_v2'; // v1 は null 焼き付き済みのため世代を上げて無効化
const NEG_TTL_MS = 6 * 60 * 60 * 1000; // 失敗の再試行抑止は6時間だけ

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

// 値の形: 成功={v:'訳'} / 失敗={v:null, at:失敗時刻}
function readCached(cache, key) {
  const e = cache[key];
  if (typeof e === 'string') return e; // 旧形式（成功のみ）互換
  if (!e || typeof e !== 'object') return undefined;
  if (e.v) return e.v;
  return Date.now() - (e.at || 0) < NEG_TTL_MS ? null : undefined; // TTL切れは未キャッシュ扱い
}

async function viaTranslate(t) {
  if (t.length > 100) return null; // /api/translate は短句のみ
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: t }),
    });
    const data = await res.json();
    return data?.ja || null;
  } catch {
    return null;
  }
}

async function viaClaude(t) {
  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'sentence', text: t }),
    });
    const data = await res.json();
    return data?.ja || null;
  } catch {
    return null;
  }
}

export async function fetchJa(text) {
  const t = (text || '').trim();
  if (!t) return null;
  const key = t.toLowerCase();
  const cache = loadCache();
  const hit = readCached(cache, key);
  if (hit !== undefined) return hit;

  const ja = (await viaTranslate(t)) ?? (await viaClaude(t));
  cache[key] = ja ? { v: ja } : { v: null, at: Date.now() };
  saveCache(cache);
  return ja;
}
