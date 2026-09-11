// 既存バックエンド（Vercel Functions）への呼び出し。js/app.js から移植。
// next-app では同一オリジンの /api/* を叩く → app/api/[...path]/route.js が
// Origin を付け替えて cine-learn.vercel.app へ中継する。
//
// ブラウザ: API_BASE='' / Origin はブラウザが自動付与。
// Node（シードスクリプト等）: CINELEARN_API_BASE で本番に直接向け、CINELEARN_API_ORIGIN で
//   許可 Origin を手動付与する（api/_origin.js のゲートを通すため）。両 env 未設定なら従来挙動。
//   ※ Origin はブラウザでは設定禁止ヘッダだが、ブラウザでは API_ORIGIN='' なので付与しない。
const API_BASE =
  (typeof process !== 'undefined' && process.env && process.env.CINELEARN_API_BASE) || '';
const API_ORIGIN =
  (typeof process !== 'undefined' && process.env && process.env.CINELEARN_API_ORIGIN) || '';

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (API_ORIGIN) {
    h.Origin = API_ORIGIN;
    h.Referer = `${API_ORIGIN}/`;
  }
  return h;
}

// Claude API を呼び出す（過負荷時は最大3回リトライ）
export async function callClaude(prompt, maxTokens = 2000, onRetry = null) {
  const delays = [3000, 6000, 12000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(`${API_BASE}/api/claude`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, maxTokens }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.content[0].text;
    }
    const err = await res.json();
    if ((res.status === 529 || res.status === 429) && attempt < delays.length) {
      const waitSec = delays[attempt] / 1000;
      if (onRetry) onRetry(attempt + 1, waitSec);
      await new Promise((r) => setTimeout(r, delays[attempt]));
      continue;
    }
    throw new Error(err.error?.message || 'APIエラー');
  }
}

// サーバ組みプロンプトのモード（recommend / title_search / resolve_titles 等）を叩く汎用入口（2026-09-12）。
// 共有キャッシュ命中は即返る。429 は再試行せず、呼び出し側に分かる文言で投げる。
export async function callClaudeMode(body) {
  const res = await fetch(`${API_BASE}/api/claude`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 429) throw new Error('混雑しています。しばらくしてからお試しください');
  if (!res.ok) throw new Error(data?.error?.message || data?.error || 'APIエラー');
  return data;
}

// 例文（1文）の一括和訳（/api/claude mode:'sentences'・2026-09-11）。
//   共有キャッシュ命中分は無償、未命中だけサーバが Haiku で訳して共有キャッシュと vocab_cache 行へ書き戻す。
//   {tmdbId, season, episode, type} を添えると、その話の共有キャッシュ行の空欄が埋まる。
//   429 は再試行しない（呼び出し側が静かに打ち切る＝再試行嵐で生成枠を食わない）。
//   旧サーバ（このモード未対応）は 400 'prompt is required' を返す → unsupported:true で呼び出し側が止まる。
export async function translateSentences({ sentences, tmdbId, season, episode, type }) {
  const list = Array.isArray(sentences) ? sentences : [];
  const empty = { ja: list.map(() => null), rateLimited: false, unsupported: false };
  if (!list.length) return empty;
  try {
    const res = await fetch(`${API_BASE}/api/claude`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ mode: 'sentences', sentences: list, tmdbId, season, episode, type }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const ja = Array.isArray(data?.ja) && data.ja.length === list.length ? data.ja : empty.ja;
    if (res.status === 429) return { ja, rateLimited: true, unsupported: false };
    if (!res.ok) return { ...empty, unsupported: res.status === 400 && !Array.isArray(data?.ja) };
    return { ja, rateLimited: false, unsupported: false };
  } catch {
    return empty;
  }
}

// Open Subtitles で字幕を検索する。
// type='movie' の場合は season/episode を送らず、tmdbId があれば厳密検索する
export async function searchSubtitles(title, season, episode, type = 'tv', tmdbId = null) {
  const body = { action: 'search', query: title };
  if (type === 'movie') {
    body.type = 'movie';
    if (tmdbId) body.tmdbId = tmdbId;
  } else {
    body.season = season;
    body.episode = episode;
    // TVも tmdbId を渡す＝サーバーが parent_tmdb_id 検索に切替（日本語題でもヒットする）。
    if (tmdbId) body.tmdbId = tmdbId;
  }
  const res = await fetch(`${API_BASE}/api/subtitles`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('字幕の検索に失敗しました');
  const data = await res.json();
  return data.data;
}

// 字幕ファイルをダウンロードする
export async function downloadSubtitle(fileId) {
  const res = await fetch(`${API_BASE}/api/subtitles`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ action: 'download', fileId }),
  });
  if (!res.ok) throw new Error('字幕のダウンロードに失敗しました');
  return await res.text();
}

// TMDb API を叩く薄いラッパ（action ごとに body を渡す）
export async function tmdb(body) {
  const res = await fetch(`${API_BASE}/api/tmdb`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });
  return res.json();
}

// 共有単語キャッシュ（/api/vocab）の参照（★読み取り専用★）。
// 戻り値: { hit, words, meta } / { blocked:true }（カタログ外・ゲート有効時）/ { miss:true }。
// 失敗・未デプロイ・例外はすべて { miss:true } に倒し、呼び出し側は従来生成にフォールバックする
// （キャッシュは「あれば速い」最適化であり必須依存にしない＝設計 NFR-4）。
// ★2026-09-12: 通信失敗・サーバ側の DB 不調（unavailable）は本当の miss ではない。1.5秒おいて
//   1回だけ引き直し、それでも駄目なら miss に倒す（可用性優先＝リストは出す。再生成 ¥7 は最後の手段）。
export async function fetchSharedVocab({ tmdbId, season, episode, type }) {
  const once = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vocab`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ tmdbId, season, episode, type }),
      });
      if (!res.ok) return { miss: true, unavailable: true };
      return await res.json();
    } catch {
      return { miss: true, unavailable: true };
    }
  };
  let r = await once();
  if (r?.unavailable) {
    await new Promise((ok) => setTimeout(ok, 1500));
    r = await once();
    if (r?.unavailable) console.warn('[CL:GEN] 共有キャッシュに到達できず（2回失敗）→ 従来生成へ');
  }
  return r;
}

// フェーズ1：都度生成したスーパーセットを共有キャッシュへ寄与する（fire-and-forget）。
// サーバー側（/api/vocab-contribute, service_role）が品質ゲートを通して upsert。
// 失敗は握りつぶす（表示・学習体験には影響しない）。
export async function contributeVocab({ tmdbId, season, episode, type, displayTitle, words }) {
  try {
    await fetch(`${API_BASE}/api/vocab-contribute`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ tmdbId, season, episode, type, displayTitle, words }),
    });
  } catch {
    /* 寄与失敗は無視 */
  }
}
