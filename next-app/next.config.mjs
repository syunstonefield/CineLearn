/** @type {import('next').NextConfig} */
const nextConfig = {
  // 親ディレクトリ（既存アプリ）にも package-lock.json があるため明示する
  turbopack: { root: import.meta.dirname },
  // ルートレイアウトが (marketing)/(app) の2系統のため、全ルート共通404は
  // app/global-not-found.js（レイアウト非依存の実験的規約）で提供する。
  experimental: { globalNotFound: true },
  // バックエンドは既存の Vercel Functions（cine-learn.vercel.app/api/*）を
  // そのまま使う。中継は app/api/[...path]/route.js（Originチェック対応）が担当。
  //
  // 開発時に実機（スマホ等）からLAN IPでアクセスすると、Next.jsが /_next/ の
  // dev リソースをクロスオリジン扱いで拒否し、JSがhydrateされず画面が真っ白になる。
  // 同一LANの端末からの実機確認を許可する（開発専用・本番ビルドには影響しない）。
  allowedDevOrigins: ['192.168.3.165', '192.168.3.*'],
};

export default nextConfig;
