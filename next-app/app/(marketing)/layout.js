import './landing.css';

// route group (marketing) 用のルートレイアウト。
// アプリ本体 (app) とは別ルートレイアウトなので、グループ間の遷移は
// フルリロードになり、style.css と landing.css が混ざらない。
export const metadata = {
  title: 'CineLearn — ドラマで学ぶ、究極の英語習得',
  description:
    'Netflix・YouTubeを観ながら英語が身につく。AIと忘却曲線アルゴリズムが、あなたの視聴体験を最強の学習ルーティンに変える。',
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
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
