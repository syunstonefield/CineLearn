// サーバ側ライブラリ（lib/server/*）で共有する定数・上限値・共通エラー型。
//   ・モデル名・キャッシュ版・上限値の「複製」をここ1か所へ集約する（7箇所に散っていた
//     'claude-haiku-4-5-20251001' や `v${VOCAB_CACHE_VERSION}` の同期漏れを断つ）。
//   ・上限値は env `CL_VOCAB_LIMIT_*` 等で上書きできる（値の確定はオーナー判断＝A30）。
//   ・seed（素の Node）からも import されるため、'next/server' や '@/…' は使わない（node:* と相対のみ）。

// env の正整数を読む（未設定・不正値は既定へ）。
function envInt(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

// ── モデル ──
// 単語生成・文脈訳・例文和訳・推薦のすべてがこの1定数を参照する。変更はここだけ。
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ── Supabase ──
// anon キーは公開値（ブラウザにも埋め込まれている）。service_role は env のみ（既定なし）。
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// 共有単語キャッシュの版（cache_key の v{n}）。/api/vocab・seed と必ず一致させる（本番は 2）。
export const VOCAB_CACHE_VERSION = Number(process.env.VOCAB_CACHE_VERSION || 1) || 1;
// カタログゲート。'true' でカタログ外の生成/配信を {blocked:true} にする（既定は無効＝全作品許可）。
export const CATALOG_GATE_ENABLED = process.env.CATALOG_GATE_ENABLED === 'true';

// ── 生成の上限値（1話=1カウント・チャンク数に依らない）──
//   匿名: IP バケット / ログイン: user:<uid> の日次・時次 ＋ IP 日次（アカウント量産の天井）。
export const VOCAB_LIMITS = {
  anon: {
    perMin: envInt('CL_VOCAB_LIMIT_ANON_PER_MIN', 2),
    perHour: envInt('CL_VOCAB_LIMIT_ANON_PER_HOUR', 6),
    perDay: envInt('CL_VOCAB_LIMIT_ANON_PER_DAY', 8),
  },
  user: {
    perHour: envInt('CL_VOCAB_LIMIT_USER_PER_HOUR', 15),
    perDay: envInt('CL_VOCAB_LIMIT_USER_PER_DAY', 30),
  },
  ip: {
    perDay: envInt('CL_VOCAB_LIMIT_IP_PER_DAY', 60),
  },
};

// /api/example mode:'manual'（A4）: IP 分/日 ＋ ユーザー×話/日 ＋ 全ユーザー共通×話/日。
export const EXAMPLE_MANUAL_LIMITS = {
  perMin: envInt('CL_EXAMPLE_MANUAL_PER_MIN', 10),
  perDay: envInt('CL_EXAMPLE_MANUAL_PER_DAY', 100),
  perUserEpisodeDay: envInt('CL_EXAMPLE_MANUAL_PER_USER_EP_DAY', 20),
  perEpisodeDay: envInt('CL_EXAMPLE_MANUAL_PER_EP_DAY', 60),
};
// 既存 anchor/near 経路の話単位天井（rl:example:<ip>:ep:<cacheKey>:d:<day>）。
export const EXAMPLE_EPISODE_DAY_LIMIT = envInt('CL_EXAMPLE_PER_EP_DAY', 100);

// ── 生成の時間予算・ロック・否定キャッシュ（A1）──
export const GENERATE_DEADLINE_MS = 240_000; // route が deadlineAt = now + これ を配る
export const VOCAB_LOCK_TTL_SEC = 300; // lock:vocab:<cacheKey>
export const NOGEN_TTL_SEC = 3600; // nogen:vocab:<cacheKey>（timeout は短め）
export const NOGEN_TIMEOUT_TTL_SEC = 900;
export const FAIL_COUNT_TTL_SEC = 86400; // fail:vocab:<cacheKey>
export const FAIL_COUNT_MAX = 2; // これを超えたら nogen 扱い
export const BUSY_RETRY_AFTER_SEC = 8;

// ── 字幕（OpenSubtitles / subtitle_raw_cache）──
export const RAW_CACHE_TTL_DAYS = 30; // 30条の4 の内部解析キャッシュ。字幕ライブラリ化させない
export const OS_DL_DAILY_CAP = envInt('CL_OS_DL_DAILY_CAP', 700); // 生成用 DL の日次上限（共有枠の保護・A5）
export const OS_DL_WARN_REMAINING = 50; // 残枠がこれ未満で console.warn
export const OS_CANDIDATES_MAX = 3; // 上位何候補まで DL を試すか（musicRatio / 短すぎ のときだけ次へ）
export const OS_MUSIC_RATIO_MAX = 5; // ♪ が100字あたりこれ超＝歌詞字幕として除外
export const MIN_SRT_CHARS = 200; // parseSrt(text).length がこれ未満＝字幕として短すぎ
export const NOSUB_TTL_SEC = 86400; // nosub:<key>（OS 検索が空）
export const PROBE_TTL_SEC = 6 * 3600; // probe:<key>

// ── 品質ゲート（vocab-contribute から移設・決定E）──
export const MIN_WORDS = 20; // clean 語数の下限
export const MIN_DRAMA_WORDS = 5; // drama（字幕内・逐語例文）語の下限
export const MAX_WORDS = 300; // 異常データ防止
export const VOCAB_COUNT_MIN = 20; // vocabCount の受理範囲（route の検証用）
export const VOCAB_COUNT_MAX = 60;
export const VOCAB_COUNT_DEFAULT = 40;

// ── 認証（auth.js）──
export const AUTH_TOKEN_CACHE_MAX = 500; // sha256(token)→{uid,exp} の Map 上限（最古削除）
export const AUTH_TOKEN_TTL_MS = 5 * 60 * 1000; // キャッシュ TTL（JWT exp との min）

// ── 上流失敗の共通エラー型 ──
// route は `err instanceof UpstreamError` で 502 `{error:'upstream', reason}` に写す。
//   reason: 'os_quota'（OS 残枠 0 / 406 / 日次キャップ）・'os_search'・'os_download'・'tmdb'・
//           'llm'（Anthropic 非2xx）・'timeout'（予算超過）・'generation'（0語チャンク等）・'misconfigured'
//   status: 上流の HTTP ステータス（分かるときだけ）。メッセージに本文は含めない（A20）。
export class UpstreamError extends Error {
  constructor(reason, { status, cause } = {}) {
    super(`upstream:${reason}${status ? `:${status}` : ''}`);
    this.name = 'UpstreamError';
    this.code = 'upstream';
    this.reason = reason;
    if (status != null) this.status = status;
    if (cause) this.cause = cause;
  }
}
