import './landing.css';

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
    'Netflix・Amazon Prime・Disney+を観ながら英語が身につく。AIと間隔反復が、あなたの視聴体験を学習ルーティンに変える。',
  openGraph: {
    title: 'CineLearn — ドラマで英語を学ぶ',
    description:
      'Netflix・Amazon Prime・Disney+の字幕から、クリックだけで単語帳へ。間隔反復で復習まで。',
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
  // ソフトローンチ中は低露出方針で検索インデックスを切る（X・直リンク等で配布）。
  // フィードバックで製品が固まり、法的カバーが進んだ段で index:true に切替。
  robots: { index: false, follow: false },
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
      </body>
    </html>
  );
}
