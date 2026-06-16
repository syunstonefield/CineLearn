import '../style.css';

export const metadata = {
  title: 'CineLearn — ドラマで英語を学ぶ',
  description: 'ドラマの字幕で英単語を予習・復習する語学学習アプリ',
  manifest: '/manifest.json',
  // ホーム画面に追加した時の表示（iOS/Android）
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'CineLearn' },
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
};

export const viewport = {
  themeColor: '#c8a96e',
  // ノッチ/ホームインジケータ領域まで描画し、safe-area-inset を有効化
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>
        {/* 既存 index.html と同じ Google Fonts（React が <head> へ巻き上げる） */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          precedence="default"
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@300;400;500&display=swap"
        />
        {children}
      </body>
    </html>
  );
}
