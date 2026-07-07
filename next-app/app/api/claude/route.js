// 単語生成・クイズ生成用の Claude 中継（1ホップ化）。
// 旧 cine-learn.vercel.app/api/claude.js からの移植。従来は [...path] の catch-all が
// 旧バックエンドへ2ホップ中継していた（cold 実測 1.27s）。専用 route は catch-all より
// 優先されるため、このファイルの存在だけで /api/claude は1ホップになる。
// 鍵は cinelearn-next に設定済み。旧 cine-learn への移行期フォールバック（relayLegacy）は撤去した。

export const dynamic = 'force-dynamic';

import { createHash } from 'crypto';
import { checkRateLimit } from '@/lib/ratelimit';

// ── 文脈つき語義（mode:'wordsense'）用の共有キャッシュ ──
// translation_ctx_cache は service_role 専用（未設定ならキャッシュ無しで動く）。
// 主キー= word+target_lang+sense_hash（sense_hash=正規化した字幕文のハッシュ）。
// tmdb_id 等は付帯メタ（拡張のクリック時点では未解決のため主キーにしない）。
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// 字幕文の正規化（空白・大小・引用符の揺れで別キーにならないように）→ 16hex。
function senseHash(sentence) {
  const norm = String(sentence).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

async function readCtxCache(word, hash) {
  if (!SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/translation_ctx_cache?word=eq.${encodeURIComponent(word)}&target_lang=eq.ja&sense_hash=eq.${hash}&select=translated&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }, cache: 'no-store' }
    );
    const rows = JSON.parse(await res.text());
    return Array.isArray(rows) && rows[0]?.translated ? rows[0].translated : null;
  } catch {
    return null;
  }
}

function writeCtxCache(word, hash, translated, sentence) {
  if (!SUPABASE_SERVICE_KEY) return;
  // fire-and-forget（応答を待たせない）
  fetch(`${SUPABASE_URL}/rest/v1/translation_ctx_cache?on_conflict=word,target_lang,sense_hash`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    cache: 'no-store',
    body: JSON.stringify([
      {
        word,
        target_lang: 'ja',
        sense_hash: hash,
        translated,
        sentence_sample: String(sentence).slice(0, 200),
        created_at: new Date().toISOString(),
      },
    ]),
  }).catch(() => {});
}

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
  if (s.startsWith('chrome-extension://')) return true;
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

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'server_misconfigured' }, 500); // 鍵は設定済みの前提（旧経路フォールバックは撤去）

  // ── mode:'wordsense'＝文脈つき語義（docs/design-context-translation.md）──
  //   プロンプトはサーバ側で組む（クライアント文字列を実行しない）・max_tokens 64 固定。
  //   キャッシュ命中は無条件・無償配布＝レート制限より先に返す。
  //   新規 Haiku 生成のみ IP 日次50回で絞る（財布攻撃の天井 ≈¥5/日/IP）。
  if (body.mode === 'wordsense') {
    const word = String(body.word || '').trim();
    const sentence = String(body.sentence || '').trim().slice(0, 300);
    if (!word || word.length > 50 || !sentence) return json({ ja: null, error: 'bad request' }, 400);

    const hash = senseHash(sentence);
    const cached = await readCtxCache(word.toLowerCase(), hash);
    if (cached) return json({ ja: cached, via: 'cache' });

    if (!(await checkRateLimit(req, 'wordsense', { perMin: 20, perHour: 100, perDay: 50 })).ok) {
      return json({ ja: null, error: 'rate_limited' }, 429);
    }

    const prompt =
      `字幕のセリフ: "${sentence}"\n` +
      `このセリフにおける "${word}" の意味を日本語で答えてください。` +
      `名詞句または短い語句で15字以内。説明・記号・引用符は付けず、意味だけを出力してください。`;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 64,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!r.ok) return json({ ja: null }); // Haiku不調 → クライアントは速報訳へフォールバック
      const data = await r.json();
      const ja = (data?.content?.[0]?.text || '').trim().replace(/^["「『]|["」』]$/g, '');
      if (!ja || ja.length > 30) return json({ ja: null }); // 形式崩れは配らない（誤配布防止）
      writeCtxCache(word.toLowerCase(), hash, ja, sentence);
      return json({ ja, via: 'haiku' });
    } catch {
      return json({ ja: null });
    }
  }

  // ── 既定モード＝単語リスト/クイズ生成 ──
  // ゲート通過後の課金天井：IP単位 30/分・300/時（Upstash env 未設定なら no-op）。
  if (!(await checkRateLimit(req, 'claude')).ok) return json({ error: 'rate_limited' }, 429);

  const { prompt } = body;
  if (!prompt) return json({ error: 'prompt is required' }, 400);
  // サーバ側強制: maxTokens はクライアント値を丸呑みせず天井を張る
  // （正規の最大は vocab.js のスーパーセット生成 12000）。悪用時の1呼び出しコスト上限。
  const maxTokens = Math.min(Number(body.maxTokens) || 2000, 12000);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
