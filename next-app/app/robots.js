// robots.txt（Next.js metadata file convention）。2026-10-11 公開拡大で追加。
// /api は API 専用・/app はアプリ画面（layout 側で noindex）。LP・規約・PP・サポートはクロール可。
export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
    sitemap: 'https://cinelearn-next.vercel.app/sitemap.xml',
  };
}
