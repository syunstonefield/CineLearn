/** @type {import('next').NextConfig} */
const nextConfig = {
  // 親ディレクトリ（既存アプリ）にも package-lock.json があるため明示する
  turbopack: { root: import.meta.dirname },
  // バックエンドは既存の Vercel Functions（cine-learn.vercel.app/api/*）を
  // そのまま使う。中継は app/api/[...path]/route.js（Originチェック対応）が担当。
};

export default nextConfig;
