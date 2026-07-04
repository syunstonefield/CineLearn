// 全ルート共通の404。ルートレイアウトが (marketing)/(app) の2系統あるため、
// レイアウト合成に依存しない global-not-found を使う（next.config の
// experimental.globalNotFound で有効化・完全なHTML文書を返す規約）。
// 見た目は landing.css/style.css に依存せずインラインで自己完結（privacy/support と同じ作法）。

export const metadata = {
  title: 'ページが見つかりません — CineLearn',
  robots: { index: false, follow: false },
};

const wrap = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px 20px',
  background: 'linear-gradient(180deg, #1a1612 0%, #0f0d0b 100%)',
  color: '#f0e6d6',
  fontFamily: "'DM Sans', system-ui, sans-serif",
  textAlign: 'center',
};
const code = {
  fontFamily: 'Georgia, serif',
  fontSize: 88,
  fontWeight: 700,
  color: '#c8a96e',
  lineHeight: 1,
  marginBottom: 12,
};
const msg = { fontSize: 17, marginBottom: 8 };
const sub = { fontSize: 13, color: '#968a78', marginBottom: 36 };
const btnRow = { display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' };
const btn = {
  display: 'inline-block',
  padding: '12px 28px',
  borderRadius: 999,
  background: '#c8a96e',
  color: '#1a1612',
  fontWeight: 600,
  fontSize: 14,
  textDecoration: 'none',
};
const btnGhost = {
  ...btn,
  background: 'transparent',
  color: '#c8a96e',
  border: '1px solid #c8a96e',
};

export default function GlobalNotFound() {
  return (
    <html lang="ja">
      <body style={{ margin: 0 }}>
        <main style={wrap}>
          <div style={code}>404</div>
          <p style={msg}>ページが見つかりませんでした</p>
          <p style={sub}>URLが変更されたか、入力に誤りがある可能性があります。</p>
          <div style={btnRow}>
            <a href="/" style={btn}>トップへ戻る</a>
            <a href="/app" style={btnGhost}>学習アプリを開く</a>
          </div>
        </main>
      </body>
    </html>
  );
}
