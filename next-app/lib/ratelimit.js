// 課金 API（Anthropic / OpenSubtitles 枠）の濫用上限。IP 単位の固定ウィンドウ計数。
// root の api/_ratelimit.js を App Router 用（Web Request）に移植したもの。
//   ・Upstash Redis REST（HTTP fetch のみ・追加依存なし）でカウンタを共有保持する。
//   ・UPSTASH_REDIS_REST_URL / _TOKEN が未設定なら no-op（素通し）＝外部通信もしない。
//   ・Upstash 不調・非200・パース不能は fail-open（ok:true）＝可用性優先で機能を止めない。
//
// 使い方: if (!(await checkRateLimit(req, 'claude')).ok) return json({...}, 429)
//   req は route handler の Request（headers.get() でアクセス）。

const URL_ENV = 'UPSTASH_REDIS_REST_URL';
const TOKEN_ENV = 'UPSTASH_REDIS_REST_TOKEN';

// 既定上限：1 IP あたり 30/分・300/時（backlog の合意値・root 側と同値）。
// perDay は任意（文脈訳 wordsense の「新規生成のみ日次50回」等・未指定なら日次無制限）。
const DEFAULT_LIMITS = { perMin: 30, perHour: 300, perDay: 0 };

// x-forwarded-for の先頭ホップを正規クライアント IP として使う（Vercel が付与）。
function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  const first = String(xff).split(',')[0].trim();
  return first || 'unknown';
}

// 戻り値: { ok: boolean }。ok:false のときのみ呼び出し側で 429 を返す。
export async function checkRateLimit(req, bucket, limits = {}) {
  const url = process.env[URL_ENV];
  const token = process.env[TOKEN_ENV];
  if (!url || !token) return { ok: true }; // env 未設定 → no-op

  const { perMin, perHour, perDay } = { ...DEFAULT_LIMITS, ...limits };
  const ip = clientIp(req);
  const now = Date.now();
  const minKey = `rl:${bucket}:${ip}:m:${Math.floor(now / 60000)}`;
  const hourKey = `rl:${bucket}:${ip}:h:${Math.floor(now / 3600000)}`;
  const dayKey = `rl:${bucket}:${ip}:d:${Math.floor(now / 86400000)}`; // UTC日境界（JST厳密性は不要・上限器なので）

  try {
    // 固定ウィンドウ：INCR でカウントし、EXPIRE ... NX で初回ヒット時だけ TTL を張る。
    const cmds = [
      ['INCR', minKey],
      ['EXPIRE', minKey, '60', 'NX'],
      ['INCR', hourKey],
      ['EXPIRE', hourKey, '3600', 'NX'],
    ];
    if (perDay > 0) cmds.push(['INCR', dayKey], ['EXPIRE', dayKey, '86400', 'NX']);
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
    if (!res.ok) return { ok: true }; // 非200 → fail-open
    const out = await res.json();
    const minCount = Number(out?.[0]?.result);
    const hourCount = Number(out?.[2]?.result);
    if (Number.isFinite(minCount) && minCount > perMin) return { ok: false };
    if (Number.isFinite(hourCount) && hourCount > perHour) return { ok: false };
    if (perDay > 0) {
      const dayCount = Number(out?.[4]?.result);
      if (Number.isFinite(dayCount) && dayCount > perDay) return { ok: false };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // Upstash 不調 → fail-open
  }
}
