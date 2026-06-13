import './style.css';

export const metadata = {
  title: 'CineLearn — ドラマで英語を学ぶ',
};

export const viewport = {
  themeColor: '#c8a96e',
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
