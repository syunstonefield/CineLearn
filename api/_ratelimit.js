// 課金 API（Anthropic / OpenSubtitles 枠）の濫用上限。IP 単位の固定ウィンドウ計数。
//   ・Upstash Redis REST（HTTP fetch のみ・追加依存なし）でカウンタを共有保持する。
//     Vercel のサーバーレス関数はリクエストごとに使い捨てでメモリを共有できないため、
//     関数の外（Upstash）にカウンタを置く。
//   ・UPSTASH_REDIS_REST_URL / _TOKEN が未設定なら no-op（素通し）＝外部通信もしない。
//     → オーナーが env を設定するまで既存挙動を壊さない。
//   ・Upstash 不調・非200・パース不能は fail-open（ok:true）＝可用性優先で機能を止めない。
//
// 使い方: if (!(await checkRateLimit(req, 'claude')).ok) return res.status(429)...
//   req は Vercel Node 関数の req（req.headers はキー小文字の plain object）。

const URL_ENV = 'UPSTASH_REDIS_REST_URL';
const TOKEN_ENV = 'UPSTASH_REDIS_REST_TOKEN';

// 既定上限：1 IP あたり 30/分・300/時（[[backlog]] の合意値）。
const DEFAULT_LIMITS = { perMin: 30, perHour: 300 };

// x-forwarded-for の先頭ホップを正規クライアント IP として使う（Vercel が付与）。
function clientIp(req) {
  const h = req.headers || {};
  const xff = h['x-forwarded-for'] || h['x-real-ip'] || '';
  const first = String(xff).split(',')[0].trim();
  return first || 'unknown';
}

// 戻り値: { ok: boolean }。ok:false のときのみ呼び出し側で 429 を返す。
export async function checkRateLimit(req, bucket, limits = {}) {
  const url = process.env[URL_ENV];
  const token = process.env[TOKEN_ENV];
  // env 未設定 → no-op 素通し（外部通信なし）。
  if (!url || !token) return { ok: true };

  const { perMin, perHour } = { ...DEFAULT_LIMITS, ...limits };
  const ip = clientIp(req);
  const now = Date.now();
  const minKey = `rl:${bucket}:${ip}:m:${Math.floor(now / 60000)}`;
  const hourKey = `rl:${bucket}:${ip}:h:${Math.floor(now / 3600000)}`;

  try {
    // 固定ウィンドウ：INCR でカウントし、EXPIRE ... NX で初回ヒット時だけ TTL を張る
    //   （NX で後続 INCR が TTL をリセットしない＝窓が最初のヒットから固定）。
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', minKey],
        ['EXPIRE', minKey, '60', 'NX'],
        ['INCR', hourKey],
        ['EXPIRE', hourKey, '3600', 'NX'],
      ]),
    });
    if (!res.ok) return { ok: true }; // 非200 → fail-open
    const out = await res.json();
    // out は [{result}|{error}, ...]。INCR の結果は新しいカウント（数値）。
    const minCount = Number(out?.[0]?.result);
    const hourCount = Number(out?.[2]?.result);
    if (Number.isFinite(minCount) && minCount > perMin) return { ok: false };
    if (Number.isFinite(hourCount) && hourCount > perHour) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: true }; // Upstash 不調・ネットワーク例外 → fail-open
  }
}
