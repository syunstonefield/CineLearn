import '../style.css';

export const metadata = {
  title: 'CineLearn — ドラマで英語を学ぶ',
  description: 'ドラマの字幕で英単語を予習・復習する語学学習アプリ',
  manifest: '/manifest.json',
  // ホーム画面に追加した時の表示（iOS/Android）
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'CineLearn' },
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
  // ソフトローンチ中は低露出方針で検索インデックスを切る（後述の方針が固まったら解除）。
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: '#c8a96e',
  // ノッチ/ホームインジケータ領域まで描画し、safe-area-inset を有効化
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        {/* テーマを描画前に確定してチラつきを防ぐ（保存値→システム設定の順） */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('cl_theme');if(t!=='dark'&&t!=='light'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();",
          }}
        />
        {/* 既存 index.html と同じ Google Fonts（React が <head> へ巻き上げる） */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          precedence="default"
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&family=Montserrat:wght@500;600;700&family=Playfair+Display:wght@400;700&display=swap"
        />
        {children}
      </body>
    </html>
  );
}
