// 単語生成・クイズ生成用の Claude 中継（1ホップ化）。
// 旧 cine-learn.vercel.app/api/claude.js からの移植。従来は [...path] の catch-all が
// 旧バックエンドへ2ホップ中継していた（cold 実測 1.27s）。専用 route は catch-all より
// 優先されるため、このファイルの存在だけで /api/claude は1ホップになる。
// 鍵は cinelearn-next に設定済み。旧 cine-learn への移行期フォールバック（relayLegacy）は撤去した。

export const dynamic = 'force-dynamic';

import { createHash } from 'crypto';
import { after } from 'next/server';
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
  if (!SUPABASE_SERVICE_KEY) return Promise.resolve();
  // 呼び出し側が after() に包む＝応答は待たせず、Vercel の応答後凍結でも完走させる
  return fetch(`${SUPABASE_URL}/rest/v1/translation_ctx_cache?on_conflict=word,target_lang,sense_hash`, {
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

// ── 例文（1文）和訳の共有キャッシュ・一括読み書き（mode:'sentences' 用）──
// 'sentence' モードと同じキー（word='__sentence__'・sense_hash=senseHash(trim→300字)）を使う
// ＝単語リストの後埋めと単語帳の fetchJa が同じ行を相互に命中する。
const SENT_KEY = '__sentence__';
const SENT_MAX_CHARS = 300;
const normSentence = (s) => String(s || '').trim().slice(0, SENT_MAX_CHARS);
const JA_CHAR_RE = /[぀-ヿ一-鿿]/;

async function readCtxCacheMany(word, hashes) {
  const out = new Map();
  if (!SUPABASE_SERVICE_KEY || !hashes.length) return out;
  try {
    for (let i = 0; i < hashes.length; i += 100) {
      const chunk = hashes.slice(i, i + 100);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/translation_ctx_cache?word=eq.${encodeURIComponent(word)}&target_lang=eq.ja` +
          `&sense_hash=in.(${chunk.join(',')})&select=sense_hash,translated`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }, cache: 'no-store' }
      );
      const rows = JSON.parse(await res.text());
      if (Array.isArray(rows)) for (const r of rows) if (r?.sense_hash && r.translated) out.set(r.sense_hash, r.translated);
    }
  } catch {
    /* 読めなければ未命中扱い */
  }
  return out;
}

async function writeCtxCacheMany(rows) {
  if (!SUPABASE_SERVICE_KEY || !rows.length) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/translation_ctx_cache?on_conflict=word,target_lang,sense_hash`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      cache: 'no-store',
      body: JSON.stringify(
        rows.map((r) => ({
          word: r.word,
          target_lang: 'ja',
          sense_hash: r.hash,
          translated: r.translated,
          sentence_sample: String(r.sentence).slice(0, 200),
          created_at: new Date().toISOString(),
        }))
      ),
    });
  } catch {
    /* 書けなくても応答には影響しない（次回また生成して書く） */
  }
}

// 共有単語キャッシュ（vocab_cache）の行へ、サーバが自分で訳した例文和訳だけを追記する。
//   背景（2026-09-11）: 自動寄与行は生成直後に和訳なしで書かれ、以後埋まる経路が無かった。
//   そのため同じ話を開く各ユーザーが毎回 Claude で訳し直していた（1人1話 ¥6〜9 × 人数）。
//   ここで空欄を埋めれば、次のユーザーからは AI 呼び出しゼロになる（VocabScreen は
//   example_ja のある語を既訳として扱う）。
//   規則: ① 既に入っている example_ja は絶対に上書きしない（単調・冪等）
//         ② クライアントから受け取った日本語は書かない（このマップはサーバ生成分＋共有キャッシュ命中分のみ）
//         ③ 同時更新は updated_at の条件付き PATCH（CAS）で検出し、負けたら1回だけ読み直して再適用
//   キーは /api/vocab と同じ正規化（映画は s0e0・版は env）。
function vocabCacheKeyOf({ tmdbId, season, episode, type }) {
  const id = parseInt(tmdbId, 10);
  if (!id) return null;
  const s = type === 'movie' ? 0 : Number(season) || 1;
  const e = type === 'movie' ? 0 : Number(episode) || 1;
  return `v${Number(process.env.VOCAB_CACHE_VERSION || 1)}:tmdb${id}:s${s}e${e}`;
}

async function patchVocabCacheExampleJa(ctx, jaByHash) {
  if (!SUPABASE_SERVICE_KEY || !jaByHash.size) return;
  const key = vocabCacheKeyOf(ctx);
  if (!key) return;
  const hdr = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(key)}&select=words,updated_at&limit=1`,
        { headers: hdr, cache: 'no-store' }
      );
      const rows = JSON.parse(await res.text());
      const row = Array.isArray(rows) && rows[0];
      if (!row || !Array.isArray(row.words)) return; // 行が無い（未寄与）→ 何もしない
      let changed = 0;
      const words = row.words.map((w) => {
        if (!w || !w.example || w.example_ja) return w;
        const ja = jaByHash.get(senseHash(normSentence(w.example)));
        if (!ja) return w;
        changed++;
        return { ...w, example_ja: ja };
      });
      if (!changed) return;
      // updated_at は PostgREST が返した生文字列をそのままエンコードして渡す（'+00:00' の '+' を
      // 生で送ると空白に化けて 400 になる）。一致行だけが更新される＝同時更新の検出。
      const cond =
        `cache_key=eq.${encodeURIComponent(key)}` +
        (row.updated_at ? `&updated_at=eq.${encodeURIComponent(row.updated_at)}` : '');
      const up = await fetch(`${SUPABASE_URL}/rest/v1/vocab_cache?${cond}&select=cache_key`, {
        method: 'PATCH',
        headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        cache: 'no-store',
        body: JSON.stringify({ words, updated_at: new Date().toISOString() }),
      });
      let hit = [];
      try {
        hit = JSON.parse(await up.text());
      } catch {
        hit = [];
      }
      if (up.ok && Array.isArray(hit) && hit.length) {
        console.info(`[exja] ${key}: example_ja を ${changed} 語追記`);
        return;
      }
      // 0行（同時更新に負けた）or 非2xx → 読み直して1回だけ再適用
    } catch (err) {
      console.warn('[exja] patch failed', key, String(err));
    }
  }
  console.warn('[exja] patch gave up after retry', key);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ── AI推薦・タイトル解釈の共有キャッシュ（2026-09-12）──
// 旧実装は lib/recommend.js がクライアント組みプロンプトを既定モードへ投げていた＝ユーザーごと・操作ごとに
// 課金（おすすめ1回≈¥1.5・Enter検索1回≈¥0.3）で共有されず、生成用バケットも消費していた。
// ここではプロンプトをサーバで組み、結果の JSON を translation_ctx_cache に文字列で保存して共有する
// （DDL なし・word='__reco__' 等で名前空間を分ける）。同じ条件の2人目からは 0 円。
//   キーは生のハッシュ（senseHash は英数字以外を落とすため日本語の検索語が全部同じキーになる）。
const rawHash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const JSON_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // おすすめは1か月で作り直す
async function readJsonCache(word, hash) {
  if (!SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/translation_ctx_cache?word=eq.${encodeURIComponent(word)}&target_lang=eq.ja&sense_hash=eq.${hash}&select=translated,created_at&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }, cache: 'no-store' }
    );
    const rows = JSON.parse(await res.text());
    const r = Array.isArray(rows) && rows[0];
    if (!r?.translated) return null;
    if (r.created_at && Date.now() - new Date(r.created_at).getTime() > JSON_CACHE_TTL_MS) return null;
    const v = JSON.parse(r.translated);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
const cleanStr = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanList = (v, re, max) =>
  (Array.isArray(v) ? v : []).map((x) => cleanStr(x, 30)).filter((x) => re.test(x)).slice(0, max);
const LEVEL_RE = /^[ABC][12]$/;

// キャッシュ→レート制限→Haiku→検証→after(書込) の共通経路。parse は配列を返すか null（＝配らない・保存しない）。
async function cachedJsonMode(req, apiKey, { word, key, prompt, maxTokens, parse }) {
  const hash = rawHash(`${word}|${key}`);
  const cached = await readJsonCache(word, hash);
  if (cached) return json({ items: cached, via: 'cache' });
  if (!(await checkRateLimit(req, 'reco', { perMin: 10, perHour: 60, perDay: 150 })).ok) {
    return json({ items: null, error: 'rate_limited' }, 429);
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) return json({ items: null });
    const data = await r.json();
    const text = data?.content?.[0]?.text || '';
    let arr = null;
    try {
      arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || 'null');
    } catch {
      arr = null;
    }
    const items = Array.isArray(arr) ? parse(arr) : null;
    if (!items || !items.length) return json({ items: null }); // 形式崩れは配らない・保存しない
    after(() => writeCtxCache(word, hash, JSON.stringify(items), key));
    return json({ items, via: 'haiku' });
  } catch {
    return json({ items: null });
  }
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
      after(() => writeCtxCache(word.toLowerCase(), hash, ja, sentence));
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
      after(() => writeCtxCache(SENT_KEY, hash, ja, sentence));
      return json({ ja, via: 'haiku' });
    } catch {
      return json({ ja: null });
    }
  }

  // ── mode:'recommend' / 'title_search' / 'resolve_titles'＝AI推薦・タイトル解釈（2026-09-12・共有キャッシュ）──
  if (body.mode === 'recommend') {
    const userLevel = LEVEL_RE.test(cleanStr(body.userLevel, 4)) ? cleanStr(body.userLevel, 4) : 'B1';
    const toeic = Math.max(0, Math.min(990, Math.round((Number(body.toeicScore) || 0) / 50) * 50)); // 50点刻みで丸めて共有率を上げる
    const genres = cleanList(body.genres, /^[A-Za-z][A-Za-z \-]{1,29}$/, 8);
    const services = cleanList(body.services, /^[A-Za-z0-9][A-Za-z0-9+ \-]{1,19}$/, 6);
    if (!genres.length || !services.length) return json({ items: null, error: 'bad request' }, 400);
    const key = `${userLevel}|${toeic}|${[...genres].sort().join(',')}|${[...services].sort().join(',')}`;
    const prompt = `あなたは英語学習専門のアドバイザーです。
以下の条件で海外ドラマ・映画を3作品おすすめしてください。

ユーザーの英語レベル: ${userLevel}（TOEICスコア目安: ${toeic}点）
好きなジャンル: ${genres.join(', ')}
利用可能なサービス: ${services.join(', ')}

※必ず上記のサービスで視聴できる作品のみ選んでください。

以下のJSON形式のみで返答してください（説明文不要）:
[
  {
    "title": "作品名（英語）",
    "genre": "ジャンル",
    "level": "${userLevel}",
    "platform": "視聴できるサービス名",
    "seasons": シーズン数（数字のみ）,
    "reason": "このレベルの学習者におすすめの理由（日本語・1文）",
    "speech_feature": "英語の特徴（例：はっきりした発音、スラング多め）"
  }
]`;
    const parse = (arr) =>
      arr
        .filter((x) => x && typeof x.title === 'string' && x.title.trim())
        .slice(0, 5)
        .map((x) => ({
          title: cleanStr(x.title, 80),
          genre: cleanStr(x.genre, 40),
          level: userLevel,
          platform: cleanStr(x.platform, 40),
          seasons: Number(x.seasons) || 1,
          reason: cleanStr(x.reason, 200),
          speech_feature: cleanStr(x.speech_feature, 100),
        }));
    return cachedJsonMode(req, apiKey, { word: '__reco__', key, prompt, maxTokens: 2000, parse });
  }

  if (body.mode === 'title_search') {
    const title = cleanStr(body.title, 80);
    const userLevel = LEVEL_RE.test(cleanStr(body.userLevel, 4)) ? cleanStr(body.userLevel, 4) : 'B1';
    const services = cleanList(body.services, /^[A-Za-z0-9][A-Za-z0-9+ \-]{1,19}$/, 6);
    if (!title) return json({ items: null, error: 'bad request' }, 400);
    const svcs = services.length ? services.join(', ') : 'Netflix, Amazon Prime';
    const key = `${title.toLowerCase()}|${userLevel}|${[...services].sort().join(',')}`;
    const prompt = `「${title}」について以下のJSON形式で返してください（見つからない場合は[]）。
[{"title":"${title}","genre":"ジャンル","level":"${userLevel}","platform":"視聴可能なサービス（${svcs}のいずれか）","seasons":1,"reason":"おすすめの理由（日本語・1文）","speech_feature":"英語の特徴"}]`;
    const parse = (arr) =>
      arr
        .filter((x) => x && typeof x.title === 'string' && x.title.trim())
        .slice(0, 3)
        .map((x) => ({
          title: cleanStr(x.title, 80),
          genre: cleanStr(x.genre, 40),
          level: userLevel,
          platform: cleanStr(x.platform, 40),
          seasons: Number(x.seasons) || 1,
          reason: cleanStr(x.reason, 200),
          speech_feature: cleanStr(x.speech_feature, 100),
        }));
    return cachedJsonMode(req, apiKey, { word: '__title__', key, prompt, maxTokens: 800, parse });
  }

  if (body.mode === 'resolve_titles') {
    const query = cleanStr(body.query, 80);
    if (query.length < 2) return json({ items: null, error: 'bad request' }, 400);
    const key = query.toLowerCase();
    const prompt = `ユーザーが英語学習用に海外ドラマ・映画を探しています。
検索語: "${query}"

この検索語に該当しそうな「実在する作品の英語原題」を、関連度・人気順に最大5件挙げてください。
- 日本語入力・うろ覚え・スペルミス・あいまいな説明（例:「あの弁護士ドラマ」「医療系のやつ」）も解釈する
- 実在しない作品は含めない
- 余計な説明やコメントは不要。JSON配列のみで返答:

["English Title 1", "English Title 2"]`;
    const parse = (arr) => arr.filter((t) => typeof t === 'string' && t.trim()).map((t) => cleanStr(t, 80)).slice(0, 5);
    return cachedJsonMode(req, apiKey, { word: '__resolve__', key, prompt, maxTokens: 500, parse });
  }

  // ── mode:'sentences'＝例文の一括和訳（単語リストの後埋め用・2026-09-11）──
  //   旧実装は fillMissingExampleJa がクライアント組みの10文プロンプトを既定モードへ投げていた:
  //   共有キャッシュに一切乗らず、生成用の 'claude' バケット（10/40/100）を食い、結果は本人の履歴にしか
  //   残らない＝同じ話を開く各ユーザーが毎回訳し直していた。
  //   ここでは (1) 文ごとに translation_ctx_cache を引き、命中分は無条件・無償で返す
  //            (2) 未命中だけを専用バケット 'sentences' で絞って Haiku に10文まとめて投げる
  //            (3) 応答後（after）に共有キャッシュへ書き、tmdbId があれば vocab_cache 行の空欄も埋める
  //   入力: sentences: string[]（≤10・各 ≤300字）＋任意 {tmdbId, season, episode, type}
  //   応答: { ja: (string|null)[], via: 'cache'|'haiku'|'mixed', missing: n }（429 は命中分だけ ja に載せて返す）
  if (body.mode === 'sentences') {
    const input = Array.isArray(body.sentences) ? body.sentences.slice(0, 10) : [];
    const norm = input.map(normSentence);
    if (!norm.length || norm.some((s) => !s)) return json({ ja: null, error: 'bad request' }, 400);
    const uniq = [...new Set(norm)];
    const hashOf = new Map(uniq.map((s) => [s, senseHash(s)]));
    const jaByHash = await readCtxCacheMany(SENT_KEY, uniq.map((s) => hashOf.get(s)));
    const missing = uniq.filter((s) => !jaByHash.has(hashOf.get(s)));
    const ctx = { tmdbId: body.tmdbId, season: body.season, episode: body.episode, type: body.type };
    const jaList = () => norm.map((s) => jaByHash.get(hashOf.get(s)) ?? null);
    const missingCount = () => norm.filter((s) => !jaByHash.has(hashOf.get(s))).length;

    if (!missing.length) {
      // 全命中でも、行の空欄が埋まっていないことがある（前回の書き戻し失敗・別経路の命中）→ 追記だけ試みる
      if (ctx.tmdbId) after(() => patchVocabCacheExampleJa(ctx, jaByHash));
      return json({ ja: jaList(), via: 'cache', missing: 0 });
    }
    if (!(await checkRateLimit(req, 'sentences', { perMin: 30, perHour: 100, perDay: 200 })).ok) {
      if (ctx.tmdbId && jaByHash.size) after(() => patchVocabCacheExampleJa(ctx, jaByHash));
      return json({ ja: jaList(), via: 'cache', missing: missingCount(), error: 'rate_limited' }, 429);
    }

    // プロンプトはサーバが組む。番号キーで返させ、原文を反響させない（出力トークン≈半減）。
    const prompt =
      `次の英語のセリフ（ドラマ・映画の字幕）を、それぞれ自然な日本語に訳してください。\n` +
      `出力は JSON 配列だけ: [{"i":番号,"ja":"訳文"}]。番号は入力の i と同じ。原文・説明・引用符は付けない。\n\n` +
      JSON.stringify(missing.map((e, i) => ({ i, e })));
    const newRows = [];
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
          max_tokens: Math.min(1200, 100 * missing.length + 50),
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (r.ok) {
        const data = await r.json();
        const text = data?.content?.[0]?.text || '';
        let arr = [];
        try {
          arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
        } catch {
          arr = []; // 形式崩れ＝このバッチは全て null（次回また生成）
        }
        if (Array.isArray(arr)) {
          for (const item of arr) {
            const i = Number(item?.i);
            if (!Number.isInteger(i) || i < 0 || i >= missing.length) continue;
            const ja = String(item?.ja || '').trim().replace(/^["「『]|["」』]$/g, '').trim();
            if (!ja || ja.length > 200 || !JA_CHAR_RE.test(ja)) continue; // 形式崩れは配らない
            const s = missing[i];
            const hash = hashOf.get(s);
            if (jaByHash.has(hash)) continue;
            jaByHash.set(hash, ja);
            newRows.push({ word: SENT_KEY, hash, translated: ja, sentence: s });
          }
        }
      }
    } catch {
      /* Haiku 不調 → 命中分だけ返す */
    }
    after(async () => {
      await writeCtxCacheMany(newRows);
      if (ctx.tmdbId) await patchVocabCacheExampleJa(ctx, jaByHash);
    });
    return json({ ja: jaList(), via: newRows.length && jaByHash.size > newRows.length ? 'mixed' : 'haiku', missing: missingCount() });
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
  // （正規の最大は vocab.js のスーパーセット生成＝TV1話で 13,000。2026-08-08 の係数引き上げ後、
  //   クライアントは 13,000 を要求するのにここが 12,000 のままで、TV の生成だけ黙って 1,000
  //   削られていた）。悪用時の1呼び出しコスト上限としては 12k→13k で実質差なし。
  const maxTokens = Math.min(Number(body.maxTokens) || 2000, 13000);

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
