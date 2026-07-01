// 移行期フォールバック：専用 route に必要な env（API鍵）が未設定の間だけ、
// 旧バックエンド（cine-learn.vercel.app）へ従来どおり中継する。
// 鍵を cinelearn-next に設定し終えたら、この経路は自然に使われなくなる
// （= デプロイと env 設定の順序に依存せず、どちらが先でも壊れない）。
// 中継時は Origin/Referer を正規値に付け替える（[...path]/route.js と同じ作法）。

const UPSTREAM = 'https://cine-learn.vercel.app';

export async function relayLegacy(path, body) {
  const res = await fetch(`${UPSTREAM}/api/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: UPSTREAM,
      Referer: `${UPSTREAM}/`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
