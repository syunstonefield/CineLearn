// next-app 自身の API ルート（app/api/*・Vercel Functions）への呼び出し。js/app.js から移植。
// ブラウザは同一オリジンの /api/* を叩く（旧 [...path] 中継は撤去済み・各ルートが next-app 内で完結する）。
//
// ★2026-09-12（公開拡大前ブロッカー B）: 字幕の検索/DL・任意プロンプトの Claude 呼び出し・
//   クライアントからの共有キャッシュ投稿（callClaude / searchSubtitles / downloadSubtitle /
//   contributeVocab）はここから消えた。生SRT・整形本文はクライアントへ一切配らず、単語生成は
//   サーバ内で完結する `POST /api/vocab-generate`（generateEpisodeVocab）だけが入口になる。
//   字幕の有無だけは probeSubtitle（{found,count}）で聞ける。
//
// ブラウザ: API_BASE='' / Origin はブラウザが自動付与。
// Node（シードスクリプト等）: CINELEARN_API_BASE で本番に直接向け、CINELEARN_API_ORIGIN で
//   許可 Origin を手動付与する（lib/server/origin.js のゲートを通すため）。両 env 未設定なら従来挙動。
//   ※ Origin はブラウザでは設定禁止ヘッダだが、ブラウザでは API_ORIGIN='' なので付与しない。
import { getSession } from './supabase';

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

// ログイン JWT を添えるヘッダ（A18）。サーバが resolveUserId で「ユーザー/日」の生成枠を引くため、
// vocab-generate・probe・/api/example（manual・backfill）の3経路だけに付ける（apiHeaders は不変）。
//   window が無い（seed 等の Node）・未ログインなら Authorization は付けない＝匿名扱い。
export function authHeaders() {
  const h = apiHeaders();
  if (typeof window === 'undefined') return h;
  const token = getSession()?.access_token;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
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

// 応答本文を JSON として読む（非 JSON・空本文は null）。
async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// 単語リストの生成（`POST /api/vocab-generate`・2026-09-12）。
//   サーバが 字幕取得→解析→Haiku→tsSec 付与→品質/coverage ゲート→共有キャッシュ書込 を完結し、
//   words（語＋例文1文＋tsSec）だけを返す。cache-first なので命中時は生成枠を消費しない。
//   body = { tmdbId, type:'movie'|'tv', season, episode, title?, englishTitle?, displayTitle?, vocabCount? }
//   opts.signal = AbortController の signal（画面離脱・話の切替で中断する）。
// 戻り値は throw せず、呼び出し側（VocabScreen）が switch で分岐できる平坦な形に写す:
//   { kind:'hit',          words, meta }                     … 共有キャッシュ命中（計数なし）
//   { kind:'generated',    words, meta }                     … 生成成功。meta.contributed===false は共有されない
//   { kind:'blocked' }                                       … カタログ外（ゲート有効時）
//   { kind:'nosub' }                                         … 字幕なし（枠は消費済み）
//   { kind:'nogen',        reason }                          … 否定キャッシュ（直近の失敗・品質不通過等）
//   { kind:'busy',         retryAfterSec, ttlSec }           … 同じ話を他の人が生成中（409）
//   { kind:'rate_limited', scope, loginHint, window, resetAtUtc, limit? } … 生成枠（429）
//   { kind:'unavailable' }                                   … レート制限基盤の不調（503・failClosed）
//   { kind:'upstream',     reason }                          … 上流失敗（502。reason: os_quota/timeout/tmdb/llm…）
//   { kind:'aborted' }                                       … signal で中断
//   { kind:'error',        status, message }                 … その他（400 検証・通信失敗・旧バンドル向け 400 等）
// サーバの内部コード（error 文字列）を画面に出せる日本語へ。未知のコードは既定文へ（英語コードを UI に混ぜない）。
const ERROR_CODE_MSG = {
  internal: 'サーバー内部でエラーが起きました。しばらくしてからお試しください',
  forbidden: 'この操作は許可されていません（ページを再読み込みしてください）',
  'bad request': 'リクエストが不正でした（ページを再読み込みしてください）',
  upstream: '外部サービスに接続できませんでした。しばらくしてからお試しください',
  server_misconfigured: 'サーバーの設定に問題があります。時間をおいてお試しください',
  unavailable: '混雑しています。数分後にお試しください',
  'tmdbId is required': '作品を特定できませんでした（作品を選び直してください）',
};
function messageOf(data, fallback) {
  if (typeof data?.error === 'object' && data.error?.message) return data.error.message; // A16 形はそのまま出せる
  if (typeof data?.error === 'string') return ERROR_CODE_MSG[data.error] || fallback;
  return fallback;
}

export async function generateEpisodeVocab(body, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/vocab-generate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') return { kind: 'aborted' };
    return { kind: 'error', status: 0, message: '通信に失敗しました。接続を確認してもう一度お試しください' };
  }
  const data = (await readJson(res)) || {};
  if (res.status === 409 || data.busy) {
    return {
      kind: 'busy',
      retryAfterSec: Number(data.retryAfterSec) > 0 ? Number(data.retryAfterSec) : 8,
      ttlSec: Number.isFinite(Number(data.ttlSec)) ? Number(data.ttlSec) : null,
    };
  }
  if (res.status === 429) {
    return {
      kind: 'rate_limited',
      scope: data.scope || 'anon',
      loginHint: !!data.loginHint,
      window: data.window || 'day',
      resetAtUtc: data.resetAtUtc || null,
      limit: Number.isFinite(Number(data.limit)) ? Number(data.limit) : null,
      // 文言用の上限値（サーバ定数・env で上書き可）。無ければクライアント既定（8/30）
      anonDayLimit: Number.isFinite(Number(data.anonDayLimit)) ? Number(data.anonDayLimit) : null,
      userDayLimit: Number.isFinite(Number(data.userDayLimit)) ? Number(data.userDayLimit) : null,
    };
  }
  if (res.status === 503 || data.error === 'unavailable') return { kind: 'unavailable' };
  if (res.status === 502 || data.error === 'upstream') return { kind: 'upstream', reason: data.reason || 'unknown' };
  if (!res.ok) {
    // 旧バンドル向け 400 は { error:{message}, code } の形（A16）。文言はそのまま画面へ出せる。
    // 文字列コード（internal/forbidden/…）は日本語へ写す（そのまま画面に出さない）。
    return { kind: 'error', status: res.status, message: messageOf(data, '単語リストの生成に失敗しました') };
  }
  if (data.blocked) return { kind: 'blocked', loginHint: !!data.loginHint }; // カタログ外は未ログインのみ（ログインで解除）
  if (data.nosub) return { kind: 'nosub' };
  if (Array.isArray(data.words)) {
    return { kind: data.hit ? 'hit' : 'generated', words: data.words, meta: data.meta || {} };
  }
  if (data.hit === false && data.generated === false) return { kind: 'nogen', reason: data.reason || 'unknown' };
  return { kind: 'error', status: res.status, message: '単語リストの応答が不正でした' };
}

// 字幕の有無だけを聞く（`POST /api/subtitles action:'probe'`・2026-09-12）。生SRT・件名は返らない。
//   body = { tmdbId, type, season, episode }（tmdbId 必須・A5）。
//   戻り値: { found:boolean, count:number, via?:string }。非 2xx・通信失敗は throw（画面は error 相へ）。
export async function probeSubtitle(body) {
  const res = await fetch(`${API_BASE}/api/subtitles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action: 'probe', ...body }),
  });
  const data = await readJson(res);
  if (res.status === 429) throw new Error('混雑しています。しばらくしてからお試しください');
  if (!res.ok || !data || typeof data.found !== 'boolean') {
    // 502 upstream（OS 検索の不調）等の内部コードは日本語へ写す（「（upstream）」を画面に出さない）。
    if (res.status === 502) throw new Error('字幕サービスに接続できませんでした');
    throw new Error(messageOf(data, '字幕の確認に失敗しました'));
  }
  return { found: data.found, count: Number(data.count) || 0, via: data.via };
}
