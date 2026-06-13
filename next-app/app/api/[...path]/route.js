// 既存バックエンド（cine-learn.vercel.app の Vercel Functions）への中継。
// 既存APIは Origin/Referer で本番ドメインのみ許可しているため、
// 単純な rewrite では localhost からの呼び出しが 403 になる。
// ここでサーバー側から Origin を本番ドメインに付け替えて転送する（開発用）。
const UPSTREAM = 'https://cine-learn.vercel.app';

async function proxy(req, { params }) {
  const { path } = await params;
  const search = new URL(req.url).search;
  const target = `${UPSTREAM}/api/${path.join('/')}${search}`;

  const res = await fetch(target, {
    method: req.method,
    headers: {
      'Content-Type': req.headers.get('content-type') || 'application/json',
      Origin: UPSTREAM,
      Referer: `${UPSTREAM}/`,
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
  });
}

export { proxy as GET, proxy as POST };
