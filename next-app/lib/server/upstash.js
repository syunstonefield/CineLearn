// Upstash Redis REST の薄いヘルパ（HTTP fetch のみ・追加依存なし）。
//   lib/ratelimit.js は自前で fetch する（テスト容易性と既存互換のため）。こちらは
//   ロック（lock:vocab:*）・否定キャッシュ（nogen/nosub/probe）・OS 残枠（os:dl:*）・raw cache GC（gc:rawcache:*）
//   のような「レート制限以外の小さな共有状態」向け。
//   * UPSTASH_REDIS_REST_URL / _TOKEN が未設定なら upstashConfigured() が false＝呼び出し側は「無いものとして」動く
//     （ロック無し・否定キャッシュ無し）。外部通信もしない。
//   * 各関数は失敗時に throw する。握りつぶしたい所は tryRedis(fn, fallback) で包む。
//   * fire-and-forget にしない（Vercel は応答後に処理を凍結する）。呼び出し側は必ず await。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

const URL_ENV = 'UPSTASH_REDIS_REST_URL';
const TOKEN_ENV = 'UPSTASH_REDIS_REST_TOKEN';

export function upstashConfigured(env = process.env) {
  return !!(env[URL_ENV] && env[TOKEN_ENV]);
}

function conf(env) {
  const url = env[URL_ENV];
  const token = env[TOKEN_ENV];
  if (!url || !token) throw new Error('upstash: not configured');
  return { url, token };
}

// 複数コマンドをパイプラインで実行し、各コマンドの result を配列で返す（添字はコマンド順）。
export async function redisPipeline(cmds, { env = process.env, fetchImpl = fetch } = {}) {
  const { url, token } = conf(env);
  const res = await fetchImpl(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`upstash: pipeline HTTP ${res.status}`);
  const out = await res.json();
  if (!Array.isArray(out) || out.length !== cmds.length) throw new Error('upstash: pipeline shape');
  return out.map((o) => (o && 'result' in o ? o.result : null));
}

// 単発コマンド（['GET', key] 等）。
export async function redisCommand(cmd, opts) {
  const [r] = await redisPipeline([cmd], opts);
  return r;
}

export async function redisGet(key, opts) {
  const v = await redisCommand(['GET', key], opts);
  return v == null ? null : String(v);
}

// SET key value [NX] [EX sec]。NX で取れなければ null、取れれば 'OK'。
export async function redisSet(key, value, { nx = false, ex = 0 } = {}, opts) {
  const cmd = ['SET', key, String(value)];
  if (nx) cmd.push('NX');
  if (ex > 0) cmd.push('EX', String(Math.floor(ex)));
  const r = await redisCommand(cmd, opts);
  return r == null ? null : String(r);
}

export async function redisDel(key, opts) {
  return Number(await redisCommand(['DEL', key], opts)) || 0;
}

// INCR して初回だけ TTL を張る（EXPIRE NX）。戻り値はカウント。
export async function redisIncrWithTtl(key, ttlSec, opts) {
  const [n] = await redisPipeline([['INCR', key], ['EXPIRE', key, String(Math.floor(ttlSec)), 'NX']], opts);
  return Number(n) || 0;
}

// 値が token と一致するときだけ DEL する（ロック解放用・A1）。GET→比較→DEL の2往復だが、
// ロックは TTL 300s・同一キーの競合は route の 409 で先に弾かれるので実用上十分。戻り値: 解放したか。
export async function redisDelIfEquals(key, token, opts) {
  const cur = await redisGet(key, opts);
  if (cur == null || cur !== String(token)) return false;
  await redisDel(key, opts);
  return true;
}

// UTC 日付キー（'20260912'）。os:dl:d:<UTC日> / gc:rawcache:<UTC日> の接尾辞。
export function utcDayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
}

// 失敗を握りつぶして fallback を返す（可用性優先の箇所用）。未設定なら通信せず fallback。
export async function tryRedis(fn, fallback = null, { env = process.env, log = console } = {}) {
  if (!upstashConfigured(env)) return fallback;
  try {
    return await fn();
  } catch (err) {
    log.warn?.('[CL:REDIS] failed', String(err?.message || err));
    return fallback;
  }
}
