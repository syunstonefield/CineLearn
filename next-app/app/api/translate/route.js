// 単語クリック時の英日訳ルート。拡張の background 経由で呼ばれる（content.js は直接叩かない）。
// 公式翻訳API（DeepL / Azure）の鍵をサーバー側に隠し、結果を translation_cache に保存して
// 無料枠・コストを最小化する（同じ単語は1回だけ翻訳）。鍵未設定なら ja:null（拡張は英語のみ表示）。
//
// プロバイダは env の有無で自動選択：DEEPL_API_KEY があれば DeepL、無ければ Azure。
//   - DeepL Free 鍵は末尾 ':fx' → api-free.deepl.com、Pro 鍵は api.deepl.com。
//   - Azure は AZURE_TRANSLATOR_KEY（+ 任意 AZURE_TRANSLATOR_REGION）。
// 関連: supabase_translation_cache.sql ／ 既存の /api/example と同じ作法。

export const dynamic = 'force-dynamic';

import { checkRateLimit } from '@/lib/ratelimit';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
// translation_cache は service_role 専用（未設定ならキャッシュ無しでライブ翻訳は動く）。
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const DEEPL_API_KEY           = process.env.DEEPL_API_KEY || '';
const AZURE_TRANSLATOR_KEY    = process.env.AZURE_TRANSLATOR_KEY || '';
// Azure が要求するのはリージョン「識別子」(例: japaneast)。表示名「Japan East」を
// 貼られても通るよう、小文字化＋空白除去で正規化する（識別子は表示名の小文字詰めと一致）。
const AZURE_TRANSLATOR_REGION = (process.env.AZURE_TRANSLATOR_REGION || '').toLowerCase().replace(/\s+/g, '');

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 正規アプリ（next-app / cine-learn / localhost / 拡張）からの呼び出しのみ許可。
function allowedOrigin(req) {
  const s = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!s) return true; // 同一オリジン fetch や拡張 background で origin 無しのことがある
  if (s.startsWith('chrome-extension://')) return true; // 拡張
  try {
    const u = new URL(s);
    const selfHost = req.headers.get('host') || '';
    if (selfHost && u.host === selfHost) return true; // 同一オリジン（LAN IP実機/各デプロイURL）
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true; // 開発
    return ['cinelearn-next.vercel.app', 'cine-learn.vercel.app'].includes(u.hostname);
  } catch {
    return false;
  }
}

// ── translation_cache（service_role 専用）読み書き ──
async function readCache(word, lang) {
  if (!SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/translation_cache?word=eq.${encodeURIComponent(word)}&target_lang=eq.${encodeURIComponent(lang)}&select=translated&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }, cache: 'no-store' }
    );
    const rows = JSON.parse(await res.text());
    return Array.isArray(rows) && rows[0]?.translated ? rows[0].translated : null;
  } catch {
    return null;
  }
}

function writeCache(word, lang, translated, provider) {
  if (!SUPABASE_SERVICE_KEY) return;
  // fire-and-forget（応答を待たせない）
  fetch(`${SUPABASE_URL}/rest/v1/translation_cache?on_conflict=word,target_lang`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    cache: 'no-store',
    body: JSON.stringify([
      { word, target_lang: lang, translated, provider, created_at: new Date().toISOString() },
    ]),
  }).catch(() => {});
}

// ── プロバイダ ──
async function deeplTranslate(text) {
  if (!DEEPL_API_KEY) return null;
  const host = DEEPL_API_KEY.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  try {
    const res = await fetch(`${host}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ text, source_lang: 'EN', target_lang: 'JA' }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.translations?.[0]?.text?.trim() || null;
  } catch {
    return null;
  }
}

async function azureTranslate(text) {
  if (!AZURE_TRANSLATOR_KEY) return null;
  try {
    const headers = {
      'Ocp-Apim-Subscription-Key': AZURE_TRANSLATOR_KEY,
      'Content-Type': 'application/json',
    };
    if (AZURE_TRANSLATOR_REGION) headers['Ocp-Apim-Subscription-Region'] = AZURE_TRANSLATOR_REGION;
    const res = await fetch(
      'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=ja',
      { method: 'POST', headers, body: JSON.stringify([{ Text: text }]), cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0]?.translations?.[0]?.text?.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ ja: null, error: 'forbidden' }, 403);

  // 従量課金の翻訳API（DeepL/Azure）の濫用天井。単語帳を開くと未キャッシュ語を
  // 一括翻訳するため上限は緩め（IP単位 120/分・1200/時）。Upstash 未設定なら no-op。
  if (!(await checkRateLimit(req, 'translate', { perMin: 120, perHour: 1200 })).ok) {
    return json({ ja: null, error: 'rate_limited' }, 429);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    return json({ ja: null });
  }

  const text = String(body.word || '').trim();
  if (!text || text.length > 100) return json({ ja: null }); // 単語/短句のみ
  const lang = 'ja';
  const key = text.toLowerCase(); // キャッシュキーは小文字（単語の意味は大小で変わらない）

  // ① キャッシュ
  const cached = await readCache(key, lang);
  if (cached) return json({ ja: cached, via: 'cache' });

  // ② ライブ翻訳（DeepL 優先 → Azure）
  let ja = null;
  let provider = null;
  if (DEEPL_API_KEY) {
    ja = await deeplTranslate(text);
    if (ja) provider = 'deepl';
  }
  if (!ja && AZURE_TRANSLATOR_KEY) {
    ja = await azureTranslate(text);
    if (ja) provider = 'azure';
  }

  if (!ja) return json({ ja: null }); // 鍵未設定 or 失敗 → 拡張は英語のみ表示

  writeCache(key, lang, ja, provider);
  return json({ ja, via: provider });
}
