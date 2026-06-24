// 既存バックエンド（cine-learn.vercel.app の Vercel Functions）への中継。
// 既存APIは Origin/Referer で本番ドメインのみ許可しているため、
// 単純な rewrite では localhost からの呼び出しが 403 になる。
// ここでサーバー側から Origin を本番ドメインに付け替えて転送する（開発用）。
//
// ★この中継は専用 route が無いパス（claude / subtitles / tmdb 等）にだけ落ちてくる。
//   Origin を正規値に付け替えて上流ゲートを 100% 通すため、ここで呼び出し元 Origin を
//   検証しないと第三者が curl で上流の課金 API（Anthropic / OpenSubtitles 枠）を消費できる。
//   → 転送前に allowedOrigin で正規フロント / localhost / 拡張のみ許可し、第三者を弾く。
//      （ゲート関数は app/api/example/route.js の allowedOrigin と同等の判定）
const UPSTREAM = 'https://cine-learn.vercel.app';

// 正規アプリ（next-app / cine-learn / localhost / 拡張）からの呼び出しのみ許可。
//   空 Origin（curl 等）は拒否。ヘッダは詐称可だが「カジュアルな悪用・他サイトからの
//   ブラウザ呼び出し」を弾くのが目的。app/api/example/route.js の allowedOrigin と同じ判定。
//   ★公開後 TODO: ストア公開で拡張 ID が固定したら chrome-extension:// は完全一致 ID 限定へ。
const ALLOWED_HOSTS = ['cinelearn-next.vercel.app', 'cine-learn.vercel.app']; // 本番ホスト完全一致
function allowedOrigin(req) {
  const s = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!s) return false; // 空 Origin の正規経路は無い（ブラウザは付与・拡張は chrome-extension://）
  if (s.startsWith('chrome-extension://')) return true; // 拡張（ID 限定は公開後 TODO）
  try {
    const u = new URL(s);
    // ★同一オリジン（アプリ自身が配信されているホスト）は常に許可。
    //   ブラウザが自分の /api/* を叩くのは常に same-origin だから、これで
    //   localhost / LAN IP(スマホ実機=192.168.x:3000 等) / 各 vercel デプロイURL /
    //   独自ドメイン が全部通る。第三者の別オリジン・空 Origin は弾いたまま。
    const selfHost = req.headers.get('host') || '';
    if (selfHost && u.host === selfHost) return true; // host は :port 込み
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true; // 開発
    return ALLOWED_HOSTS.includes(u.hostname);
  } catch {
    return false; // パース不能な Origin/Referer は拒否
  }
}

async function proxy(req, { params }) {
  // 転送前ゲート：正規フロント / localhost / 拡張のみ通す（第三者の curl 直叩きを弾く）。
  if (!allowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
