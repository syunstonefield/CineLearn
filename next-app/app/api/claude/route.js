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
// ver は「語義プロンプトの版」。プロンプトを変えたら版を上げてキャッシュを切り替える
// （旧行は残るが読まれない＝作り直しは新版の初回1回だけ）。
function senseHash(sentence, ver = '') {
  const norm = String(sentence).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return createHash('sha256').update(ver ? `${ver}\n${norm}` : norm).digest('hex').slice(0, 16);
}

// 文脈つき語義プロンプトの版。v2（2026-08-07）＝「基本の語義」を主にし、場面特有の意味は
// 括弧で添える形式へ変更した（旧 v1 は場面での意味だけを返すため merchandise が
// 「違法な商品」になり、単語帳の語義として一般性を失っていた＝オーナー報告）。
const WORDSENSE_PROMPT_VER = 'v3';

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
  if (!s) return false; // 空 Origin の正規経路は無い（拡張は chrome-extension:// を付ける・seedはCINELEARN_API_ORIGIN）
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
  //   新規 Haiku 生成のみ IP 日次300回で絞る（財布攻撃の天井 ≈¥9/日/IP・下の 114行に経緯）。
  if (body.mode === 'wordsense') {
    const word = String(body.word || '').trim();
    const sentence = String(body.sentence || '').trim().slice(0, 300);
    // 80 = フレーズ対応（拡張のドラッグ保存は最大6語＝理論上50字を超え得る）
    if (!word || word.length > 80 || !sentence) return json({ ja: null, error: 'bad request' }, 400);

    const hash = senseHash(sentence, WORDSENSE_PROMPT_VER);
    const cached = await readCtxCache(word.toLowerCase(), hash);
    if (cached) return json({ ja: cached, via: 'cache' });

    // 日次は 50→300（2026-08-06 オーナー判断）。50 は「安い1語訳(/api/translate)が受け皿にある」
    // 前提の数字だったが Azure 失効でその受け皿が消え、正規利用（1話20〜40語）で2話も持たずに
    // 枯れて訳が丸ごと出なくなった（実測429）。wordsense は max_tokens 64 固定＝1回≈¥0.03なので
    // 300 でも天井は ¥9/日/IP。キャッシュ命中はこの計数より先に返るので既訳語は無制限のまま。
    // バケット名 'wordsense2' は 2026-08-06 の世代替え: 旧 'wordsense' カウンタが
    // 「429の再試行もカウントする」旧仕様で数百まで汚染され、上限引き上げ後も全リクエストが
    // ブロックされ続けたため、キーを替えて即時リセットした（旧キーはTTLで自然消滅）。
    if (!(await checkRateLimit(req, 'wordsense2', { perMin: 20, perHour: 100, perDay: 300 })).ok) {
      return json({ ja: null, error: 'rate_limited' }, 429);
    }

    // 語義は「辞書の基本義」を主・「この場面での意味」を従にする（単語帳＝語を覚える道具なので、
    // 場面限定の意味だけを覚えさせない）。ずれが無い語では括弧を付けさせない＝短さを保つ。
    //   例 merchandise: ×「違法な商品、密輸品」→ ○「商品（この場面では密輸品）」
    //   例 personnel  : ×「資格を持った職員や人員」→ ○「職員・要員」
    // ★v3: 規則の言葉だけでは効かなかった（v2 を本番実測: merchandise が36字の辞書調・
    //   personnel は「必要な資格や技能を持つ職員や要員。」と場面が混ざったまま・句点つき）。
    //   出力の見本（few-shot）を付け、字数と禁止事項を具体化して形を固定する。
    const prompt =
      `字幕のセリフ: "${sentence}"\n\n` +
      `このセリフに出てくる "${word}" を、英単語帳の語義欄に載せる短い日本語にしてください。\n\n` +
      `規則:\n` +
      `- 基本の語義（辞書の中心的な意味）を12字以内で書く。類義語の列挙・説明文・句点(。)は書かない。\n` +
      `- このセリフの事情（誰が何をしているか）を基本の語義そのものに混ぜない。\n` +
      `- セリフでの使われ方が基本の意味からずれる時（隠語・比喩・皮肉・専門用法）だけ、続けて「（この場面では◯◯）」を10字以内で足す。ずれていなければ足さない。\n\n` +
      `出力の見本:\n` +
      `  merchandise / "You said, move the merchandise." → 商品（この場面では密輸品）\n` +
      `  personnel / "Qualified personnel." → 職員・要員\n` +
      `  jurisdiction / "...now under our jurisdiction." → 管轄権\n` +
      `  cold / "He gave me the cold shoulder." → 冷たい（この場面では冷淡な態度）\n\n` +
      `語義だけを1行で出力してください。`;
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
          max_tokens: 96, // v2 は「基本義（この場面では〜）」の2部構成ぶん少し長い
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!r.ok) return json({ ja: null }); // Haiku不調 → クライアントは速報訳へフォールバック
      const data = await r.json();
      const ja = (data?.content?.[0]?.text || '')
        .split('\n')[0] // 1行目だけ採る（稀に補足行が付く）
        .trim()
        .replace(/^["「『]|["」』]$/g, '')
        .replace(/[。．]+$/, '') // 語義欄に句点は要らない（指示しても付いてくることがある）
        .trim();
      // 上限は v2 の2部構成に合わせて 36 字（旧30字だと「基本義（この場面では〜）」が
      // 形式崩れ扱いで捨てられ、訳なしに落ちる）。
      if (!ja || ja.length > 36) return json({ ja: null }); // 形式崩れは配らない（誤配布防止）
      writeCtxCache(word.toLowerCase(), hash, ja, sentence);
      return json({ ja, via: 'haiku' });
    } catch {
      return json({ ja: null });
    }
  }

  // ── mode:'sentence'＝例文（1文）の和訳（2026-08-05 追加）──
  //   本番の /api/translate（DeepL/Azure）が鍵切れで ja:null しか返せなくなり、単語帳の
  //   例文和訳が出なくなっていた（実測）。Anthropic 鍵は生きているので Haiku を代替経路にする。
  //   wordsense と同じ立て付け: 共有キャッシュ（word='__sentence__'）命中は無条件配布、
  //   新規生成のみ IP 日次で絞る。max_tokens 200（1文の和訳に十分）。
  if (body.mode === 'sentence') {
    const sentence = String(body.text || body.sentence || '').trim().slice(0, 300);
    if (!sentence) return json({ ja: null, error: 'bad request' }, 400);

    const SENT_KEY = '__sentence__';
    const hash = senseHash(sentence);
    const cached = await readCtxCache(SENT_KEY, hash);
    if (cached) return json({ ja: cached, via: 'cache' });

    if (!(await checkRateLimit(req, 'sentence', { perMin: 30, perHour: 200, perDay: 300 })).ok) {
      return json({ ja: null, error: 'rate_limited' }, 429);
    }

    const prompt =
      `次の英語のセリフを自然な日本語に訳してください。訳文だけを出力し、説明・引用符・原文は付けないでください。\n` +
      `セリフ: "${sentence}"`;
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
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!r.ok) return json({ ja: null });
      const data = await r.json();
      const ja = (data?.content?.[0]?.text || '').trim().replace(/^["「『]|["」』]$/g, '');
      if (!ja || ja.length > 200) return json({ ja: null }); // 形式崩れは配らない
      writeCtxCache(SENT_KEY, hash, ja, sentence);
      return json({ ja, via: 'haiku' });
    } catch {
      return json({ ja: null });
    }
  }

  // ── 既定モード＝単語リスト/クイズ生成 ──
  // ⚠このモードは任意プロンプトを実行できる（プロンプトを組むのはクライアント）。
  //   日次上限が無いと 1 IP で 300回/時 × 12,000 out tok ＝ 約¥67,000/日 を焼ける財布攻撃が成立する
  //   （2026-08-06 公開前討論で発見）。正規利用は 1話=1コール・映画=最大3コール（分割生成）なので
  //   日100あれば重い使い方でも足り、共有IP（NAT）でも数人ぶんの余裕がある。
  //   本命はプロンプトのサーバ側生成（mode:'vocab' 化）。それまでの天井として日次を張る。
  if (!(await checkRateLimit(req, 'claude', { perMin: 10, perHour: 40, perDay: 100 })).ok) {
    return json({ error: 'rate_limited' }, 429);
  }

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
