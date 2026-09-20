// 課金 API（Anthropic / OpenSubtitles 枠）の濫用上限。固定ウィンドウ計数（§1・A27）。
// root の api/_ratelimit.js を App Router 用（Web Request）に移植し、2026-09-12 に主体（ユーザー）と任意キーへ拡張した。
//   ・Upstash Redis REST（HTTP fetch のみ・追加依存なし）でカウンタを共有保持する。
//   ・UPSTASH_REDIS_REST_URL / _TOKEN が未設定なら no-op（素通し）＝外部通信もしない。
//   ・既定は fail-open（Upstash 不調・非200・パース不能 → ok:true）＝可用性優先。
//     opts.failClosed:true のバケット（vocab-generate）だけ ok:false + unavailable:true（route は 503）。
//
// 使い方:
//   const rl = await checkRateLimit(req, 'claude');             // IP のみ・既定 30/分・300/時
//   if (!rl.ok) return json({ error: 'rate_limited', window: rl.window, resetAtUtc: rl.resetAtUtc, scope: rl.scope }, 429);
//   ... 上流失敗時 ... await rl.release();                       // 枠を戻す（ワンショット）
//   ログイン主体を足す: checkRateLimit(req, 'vocab-ip', { perDay: 60 }, { subject: `user:${uid}`, subjectLimits: { perHour: 15, perDay: 30 }, failClosed: true })
//   任意キーを足す:     opts.extra = [{ keyBase: 'rl:example-manual:ep:<cacheKey>', window: 'day', limit: 60, scope: 'episode' }]
//
// ⚠上限は「**通過した**リクエスト数」に対して張る（ブロック分は DECR して戻す）。
//   拒否分も数える実装だと、429を受けたクライアントの再試行がカウンタを膨らませ続け、
//   上限を引き上げてもロックアウトが解けない（2026-08-06 に実発生）。
// ⚠pipeline の添字は固定値でなく、キー配列から `i*2` で導出する（添字ずれ事故防止・A27）。
// seed からは import しないが、lib/server/* と同じく相対 import と fetch 以外に依存しない。

const URL_ENV = 'UPSTASH_REDIS_REST_URL';
const TOKEN_ENV = 'UPSTASH_REDIS_REST_TOKEN';

// 既定上限：1 IP あたり 30/分・300/時（backlog の合意値・root 側と同値）。perDay は任意（0＝日次無制限）。
// ★ 各値は 0 以下で「その窓は張らない」。旧実装は perMin:0 を渡すと必ずブロックされた（0 > 0 は偽だが 1 > 0 で即ブロック）。
const DEFAULT_LIMITS = { perMin: 30, perHour: 300, perDay: 0 };

// 窓の定義。tag はキーの接尾辞（m/h/d）・ttl は EXPIRE 秒。
const WINDOWS = {
  min: { ms: 60_000, ttl: 60, tag: 'm' },
  hour: { ms: 3_600_000, ttl: 3600, tag: 'h' },
  day: { ms: 86_400_000, ttl: 86400, tag: 'd' }, // UTC日境界（JST厳密性は不要・上限器なので）
};
const WINDOW_ORDER = ['min', 'hour', 'day'];

// x-forwarded-for の先頭ホップを正規クライアント IP として使う（Vercel が付与）。
export function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  const first = String(xff).split(',')[0].trim();
  return first || 'unknown';
}

// 窓の終端（リセット時刻）を ISO で。429 応答の resetAtUtc（A12・A27）。
export function windowResetAtUtc(window, now = Date.now()) {
  const W = WINDOWS[window];
  if (!W) return null;
  return new Date((Math.floor(now / W.ms) + 1) * W.ms).toISOString();
}

// keyBase（'rl:<bucket>:<主体>'）＋ limits から、張る窓ぶんのエントリ [{key, ttl, limit, window, scope, resetAtUtc}] を作る。
function entriesFor(keyBase, limits, scope, now) {
  const out = [];
  const lim = { min: limits.perMin, hour: limits.perHour, day: limits.perDay };
  for (const w of WINDOW_ORDER) {
    const limit = Number(lim[w]);
    if (!(limit > 0)) continue;
    const W = WINDOWS[w];
    const idx = Math.floor(now / W.ms);
    out.push({ key: `${keyBase}:${W.tag}:${idx}`, ttl: W.ttl, limit, window: w, scope, resetAtUtc: new Date((idx + 1) * W.ms).toISOString() });
  }
  return out;
}

// opts.extra の1件 { keyBase, window:'min'|'hour'|'day', limit, scope } → エントリ（キーに :<tag>:<idx> を付ける）。
function extraEntry(x, now) {
  const W = WINDOWS[x?.window];
  const limit = Number(x?.limit);
  if (!W || !x?.keyBase || !(limit > 0)) return null;
  const idx = Math.floor(now / W.ms);
  return { key: `${x.keyBase}:${W.tag}:${idx}`, ttl: W.ttl, limit, window: x.window, scope: x.scope || 'extra', resetAtUtc: new Date((idx + 1) * W.ms).toISOString() };
}

const noopRelease = async () => {};

async function pipeline(url, token, cmds, fetchImpl) {
  const res = await fetchImpl(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
    cache: 'no-store',
  });
  return res;
}

// INCR ... EXPIRE NX（張る）／DECR ... EXPIRE NX（戻す）をキー配列から導出する。添字は i*2。
//   DECR 直後の EXPIRE NX: DECR は「存在しないキー」を値-1で新規作成し TTL を張らない。TTL が満了した後に
//   DECR だけ走ると、値-1・TTL無しの孤児キーが永久残留する（攻撃トラフィック下で無限にゴミが溜まる）。
//   TTL が生きていれば NX は no-op なので無害。
function incrCmds(entries) {
  return entries.flatMap((e) => [['INCR', e.key], ['EXPIRE', e.key, String(e.ttl), 'NX']]);
}
function decrCmds(entries) {
  return entries.flatMap((e) => [['DECR', e.key], ['EXPIRE', e.key, String(e.ttl), 'NX']]);
}

// 低レベル: エントリ配列を張る。checkRateLimit と、任意キーだけを張りたい route の両方が使う。
//   戻り値 { ok:true, release } | { ok:false, window, scope, resetAtUtc, limit, release:noop } | { ok:false, unavailable:true, release:noop }
export async function checkRateLimitEntries(entries, { failClosed = false, env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const url = env[URL_ENV];
  const token = env[TOKEN_ENV];
  if (!url || !token) return { ok: true, release: noopRelease }; // env 未設定 → no-op（failClosed でも素通し＝設定の選択）
  if (!entries.length) return { ok: true, release: noopRelease };

  const startedAt = now();
  const unavailable = () => ({ ok: false, unavailable: true, release: noopRelease });
  let out;
  try {
    const res = await pipeline(url, token, incrCmds(entries), fetchImpl);
    if (!res.ok) return failClosed ? unavailable() : { ok: true, release: noopRelease }; // 非200 → 既定 fail-open
    out = await res.json();
  } catch {
    return failClosed ? unavailable() : { ok: true, release: noopRelease }; // Upstash 不調 → 既定 fail-open
  }

  // 応答パース。INCR は成功しているかもしれないので、failClosed で形が崩れていたら DECR を試みてから unavailable。
  const counts = entries.map((_, i) => Number(out?.[i * 2]?.result));
  if (!Array.isArray(out) || counts.some((c) => !Number.isFinite(c))) {
    if (failClosed) {
      try {
        await pipeline(url, token, decrCmds(entries), fetchImpl);
      } catch {
        /* 戻し失敗は許容 */
      }
      return unavailable();
    }
    return { ok: true, release: noopRelease };
  }

  const blockedIdx = counts.findIndex((c, i) => c > entries[i].limit);
  if (blockedIdx >= 0) {
    // ブロックしたリクエストは枠を消費させない（全キー DECR で戻す）。fire-and-forget にしない（Vercel は応答後に凍結）。
    try {
      await pipeline(url, token, decrCmds(entries), fetchImpl);
    } catch {
      /* 戻し失敗は許容（過剰カウント側に倒れるだけ） */
    }
    const b = entries[blockedIdx];
    return { ok: false, window: b.window, scope: b.scope, resetAtUtc: b.resetAtUtc, limit: b.limit, release: noopRelease };
  }

  // 通過。release は上流失敗時に枠を戻す（ワンショット）。呼び出し時点で TTL を過ぎたキーは DECR しない
  // （既に別ウィンドウ＝戻すと過去窓のキーを負にするだけ）。
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    const live = entries.filter((e) => now() - startedAt <= e.ttl * 1000);
    if (!live.length) return;
    try {
      await pipeline(url, token, decrCmds(live), fetchImpl);
    } catch {
      /* 戻し失敗は許容 */
    }
  };
  return { ok: true, release };
}

// checkRateLimit(req, bucket, limits, opts)
//   limits: { perMin, perHour, perDay }（IP 主体。0 以下の窓は張らない・未指定は既定 30/300/-）
//   opts.subject       … 'user:<uid>' 等。同じ pipeline に rl:<bucket>:<subject>:(h|d):<idx> を足す（scope 'user'）
//   opts.subjectLimits … subject 用の { perMin, perHour, perDay }（未指定なら limits と同じ）
//   opts.extra         … [{ keyBase, window, limit, scope }]（A4 の話単位キー等）
//   opts.failClosed    … Upstash 不調で ok:false + unavailable:true（vocab バケットのみ）
//   opts.ipLimitsOff   … true で IP 主体を張らない（subject / extra だけ）
export async function checkRateLimit(req, bucket, limits = {}, opts = {}) {
  const now = (opts.now || Date.now)();
  const L = { ...DEFAULT_LIMITS, ...limits };
  const entries = [];
  if (!opts.ipLimitsOff) entries.push(...entriesFor(`rl:${bucket}:${clientIp(req)}`, L, 'ip', now));
  if (opts.subject) entries.push(...entriesFor(`rl:${bucket}:${opts.subject}`, opts.subjectLimits ? { perMin: 0, perHour: 0, perDay: 0, ...opts.subjectLimits } : L, 'user', now));
  for (const x of opts.extra || []) {
    const e = extraEntry(x, now);
    if (e) entries.push(e);
  }
  return checkRateLimitEntries(entries, { failClosed: !!opts.failClosed, env: opts.env, fetchImpl: opts.fetchImpl, now: opts.now });
}
