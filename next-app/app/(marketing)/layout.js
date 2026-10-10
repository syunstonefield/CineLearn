import './landing.css';
import { Analytics } from '@vercel/analytics/next';

// route group (marketing) 用のルートレイアウト。
// アプリ本体 (app) とは別ルートレイアウトなので、グループ間の遷移は
// フルリロードになり、style.css と landing.css が混ざらない。
export const metadata = {
  // OGP画像URLを絶対化する基準。画像はファイル規約でなく public/og-image.png を
  // 明示指定（ルートレイアウトが2グループ構成のため app/ 直下の規約ファイルは
  // メタデータ解決に乗らない・2026-07-05実測）。
  metadataBase: new URL('https://cinelearn-next.vercel.app'),
  title: 'CineLearn — 観たいドラマが教材になる',
  description:
    'Netflix・Amazon Prime Video の字幕から英語が身につく。AIと間隔反復が、あなたの視聴体験を学習ルーティンに変える。',
  openGraph: {
    title: 'CineLearn — ドラマで英語を学ぶ',
    description:
      'Netflix・Amazon Prime Video の字幕から、クリックだけで単語帳へ。間隔反復で復習まで。',
    siteName: 'CineLearn',
    type: 'website',
    locale: 'ja_JP',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'CineLearn — ドラマで英語を学ぶ',
      },
    ],
  },
  twitter: { card: 'summary_large_image' },
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
  // 2026-10-11 拡張 v1.2.9 のストア審査合格を機に noindex を解除（公開拡大・オーナー決定）。
  // LP・規約・PP・サポートは検索可。robots.txt / sitemap.xml は app/robots.js・app/sitemap.js。
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: '#c8a96e',
};

export default function MarketingLayout({ children }) {
  return (
    <html lang="ja">
      <body>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          precedence="default"
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=DM+Sans:wght@300;400;500;600&display=swap"
        />
        {children}
        {/* Vercel Web Analytics（ページビュー等の匿名統計・PP §3 に記載）。(app) layout と両方に置く＝2ルートレイアウト構成 */}
        <Analytics />
      </body>
    </html>
  );
}
