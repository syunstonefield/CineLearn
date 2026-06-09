// APIプロキシの簡易アクセス制限（Origin/Referer チェック）。
// 正規の CineLearn Web アプリ・拡張機能からの呼び出しだけを許可し、
// 第三者がエンドポイントを直接叩いて API キー（課金）を悪用するのを防ぐ。
//
// 注意：ヘッダーは curl 等で詐称可能なため「強固な認証」ではなく
//       「カジュアルな悪用・他サイトからのブラウザ呼び出しを弾く」目的。
//       本番ドメイン / Vercelプレビュー / Chrome拡張 の3種を許可する。
export function isAllowedOrigin(req) {
  const ok = (s) =>
    !!s && (
      s === 'https://cine-learn.vercel.app' ||
      s.startsWith('https://cine-learn.vercel.app/') ||
      s.startsWith('chrome-extension://') ||
      /^https:\/\/cine-learn-[a-z0-9-]+\.vercel\.app(\/|$)/.test(s)
    );
  return ok(req.headers.origin) || ok(req.headers.referer);
}
